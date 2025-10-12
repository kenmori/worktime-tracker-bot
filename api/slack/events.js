import fetch from "node-fetch";
import { google } from "googleapis";
import dayjs from "dayjs";
import dotenv from "dotenv";
import getRawBody from "raw-body";

dotenv.config();

export const config = {
  api: { bodyParser: false },
};

// 🔐 Google Sheets 認証
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Slackメッセージ送信
async function sendMessage(channel, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
}

//  シートからユーザー行取得
async function findRow(userId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "A2:H",
  });
  const rows = res.data.values || [];
  const index = rows.findIndex((r) => r[0] === userId);
  return { index: index >= 0 ? index + 2 : null, rows };
}

// 🕒 分を15分単位に四捨五入（最近の15分）
function roundToNearestQuarterHour(minutes) {
  return Math.round(minutes / 15) * 15;
}

// ⏱ 分 → h（.25刻み換算）
function minutesToQuarterHours(minutes) {
  const rounded = roundToNearestQuarterHour(minutes);
  return (rounded / 60).toFixed(2);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody.toString());

    // ✅ Slack Challenge 検証
    if (body.type === "url_verification") {
      return res.status(200).send(body.challenge);
    }

    // ✅ メッセージイベント受信
    if (body.event && body.event.type === "message" && !body.event.bot_id) {
      const text = body.event.text;
      const user = body.event.user;
      const channel = body.event.channel;
      const now = dayjs();
      const dateStr = now.format("YYYY-MM-DD");
      const timeStr = now.format("HH:mm");

      const { index, rows } = await findRow(user);

      // 行がない場合は新規作成
      if (!index) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: "A2",
          valueInputOption: "RAW",
          requestBody: {
            values: [[user, dateStr, "", "", "0", "0", "0", "160"]],
          },
        });
      }

      // 🕒 開始しますー
      if (text.includes("開始しますー")) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `C${index || rows.length + 2}`,
          valueInputOption: "RAW",
          requestBody: { values: [[timeStr]] },
        });
        await sendMessage(channel, `🕒 開始時間 ${timeStr}-`);
      }

      // ☕️ 抜けますー
      if (text.includes("抜けますー")) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `D${index || rows.length + 2}`,
          valueInputOption: "RAW",
          requestBody: { values: [[`BREAK_START:${timeStr}`]] },
        });
        await sendMessage(channel, `☕️ 休憩開始 ${timeStr}`);
      }

      // 💪 再開しますー
      if (text.includes("再開しますー")) {
        const prev = rows[index - 2]?.[3] || "";
        if (prev && prev.startsWith("BREAK_START:")) {
          const startBreak = dayjs(`${dateStr} ${prev.replace("BREAK_START:", "")}`);
          const diffMin = now.diff(startBreak, "minute");
          const roundedBreak = roundToNearestQuarterHour(diffMin);
          const newTotal = Number(rows[index - 2]?.[4] || 0) + roundedBreak;

          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `E${index}`,
            valueInputOption: "RAW",
            requestBody: { values: [[newTotal]] },
          });

          await sendMessage(
            channel,
            `💪 休憩終了 ${timeStr} (休憩合計 ${minutesToQuarterHours(newTotal)}h)`
          );
        }
      }

      // 🏁 終えますー
      if (text.includes("終えますー")) {
        const row = rows[index - 2];
        const start = row?.[2];
        const totalBreak = Number(row?.[4] || 0);

        if (!start) {
          await sendMessage(channel, "⚠️ 開始時間が見つかりません。先に「開始しますー」を送ってください。");
          return res.status(200).send("OK");
        }

        const startTime = dayjs(`${dateStr} ${start}`);
        const totalMinutes = now.diff(startTime, "minute");
        const workMin = totalMinutes - totalBreak;

        // 🔢 15分単位に四捨五入
        const workHours = minutesToQuarterHours(workMin);
        const totalWorked = (
          Math.round((Number(row?.[6] || 0) + Number(workHours)) * 4) / 4
        ).toFixed(2);
        const remaining = (
          Math.round((Number(row?.[7] || 160) - totalWorked) * 4) / 4
        ).toFixed(2);

        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `D${index}:H${index}`,
          valueInputOption: "RAW",
          requestBody: {
            values: [
              [
                timeStr,
                totalBreak,
                workHours,
                totalWorked,
                remaining,
              ],
            ],
          },
        });

        const restH = minutesToQuarterHours(totalBreak);
        await sendMessage(
          channel,
          `🏁 ${start} - ${timeStr} (稼働 ${workHours}h, 休憩合計 ${restH}h)\n合計稼働: ${totalWorked}h, 残り ${remaining}h`
        );
      }

      return res.status(200).send("OK");
    }

    return res.status(200).send("No event found");
  } catch (error) {
    console.error("❌ Slack events error:", error);
    return res.status(500).send("Internal Server Error");
  }
}

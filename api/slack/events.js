import { google } from "googleapis";
import dayjs from "dayjs";
import dotenv from "dotenv";
import getRawBody from "raw-body";
dotenv.config();

const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

export const config = {
  api: {
    bodyParser: false, // Slackの検証では必要
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const rawBody = await getRawBody(req);
    const bodyString = rawBody.toString("utf8");
    const body = JSON.parse(bodyString);

    // ✅ SlackのURL検証用 challenge
    if (body.type === "url_verification" && body.challenge) {
      return res.status(200).send(body.challenge);
    }

    // ===============================
    // Slackのメッセージイベント処理
    // ===============================
    if (body.event && body.event.type === "message" && !body.event.bot_id) {
      const { user, text, channel } = body.event;
      const now = dayjs();

      const logRange = "WorkLogs!H2:M";
      const logSheet = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: logRange,
      });
      const logRows = logSheet.data.values || [];
      const userLogs = logRows.filter((r) => r[0] === user);
      const lastLog = userLogs[userLogs.length - 1] || [];
      const status = lastLog[5] || "none";

      let newRow = [...lastLog];
      let message = "";

      if (text.includes("開始します")) {
        if (status === "working" || status === "break") {
          message = "⚠️ すでに作業中です。「終えますー」で終了してください。";
        } else {
          newRow = [user, now.format(), "", "[]", "", "working"];
          message = "⏱ 作業を開始しました！";
        }
      }

      if (text.includes("抜けます")) {
        if (status !== "working") {
          message = "⚠️ 作業中でないため休憩に入れません。";
        } else {
          const breaks = JSON.parse(lastLog[3] || "[]");
          breaks.push({ start: now.format(), end: null });
          newRow[3] = JSON.stringify(breaks);
          newRow[5] = "break";
          message = "☕️ 休憩を開始しました。";
        }
      }

      if (text.includes("再開します")) {
        if (status !== "break") {
          message = "⚠️ 現在休憩中ではありません。";
        } else {
          const breaks = JSON.parse(lastLog[3] || "[]");
          const lastBreak = breaks[breaks.length - 1];
          if (lastBreak && !lastBreak.end) {
            lastBreak.end = now.format();
          }
          newRow[3] = JSON.stringify(breaks);
          newRow[5] = "working";
          message = "💪 作業を再開しました。";
        }
      }

      if (text.includes("終えます")) {
        if (!lastLog[1] || status === "finished") {
          message = "⚠️ 作業が開始されていません。";
        } else {
          const start = dayjs(lastLog[1]);
          const breaks = JSON.parse(lastLog[3] || "[]");
          const totalBreakMinutes = breaks.reduce((sum, b) => {
            if (b.start && b.end) {
              return sum + dayjs(b.end).diff(dayjs(b.start), "minute");
            }
            return sum;
          }, 0);
          const totalMinutes = now.diff(start, "minute") - totalBreakMinutes;
          const workedHours = (totalMinutes / 60).toFixed(2);

          newRow[2] = now.format();
          newRow[4] = workedHours;
          newRow[5] = "finished";

          const summaryRange = "WorkSummary!A2:F";
          const summarySheet = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: summaryRange,
          });
          const rows = summarySheet.data.values || [];
          const findRow = rows.findIndex((r) => r[1] === user);

          if (findRow >= 0) {
            const row = rows[findRow];
            const total = parseFloat(row[3] || 0);
            const worked = parseFloat(row[4] || 0) + parseFloat(workedHours);
            const remaining = (total - worked).toFixed(2);

            await sheets.spreadsheets.values.update({
              spreadsheetId: SHEET_ID,
              range: `WorkSummary!A${findRow + 2}:F${findRow + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: [[row[0], row[1], row[2], total, worked, dayjs().format()]],
              },
            });

            message = `✅ 作業終了！実働 *${workedHours}h* を追加しました。\n📊 残り稼働時間: *${remaining}h* (合計${total}h / 消化${worked}h)`;
          } else {
            message = `✅ 作業終了！実働 *${workedHours}h* を追加しました。`;
          }
        }
      }

      // Google Sheets に追記
      if (newRow.length > 0 && message) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: logRange,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [newRow] },
        });
      }

      // Slackに返信
      if (message) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          },
          body: JSON.stringify({ channel, text: message }),
        });
      }

      return res.status(200).send("ok");
    }

    return res.status(200).send("no event");
  } catch (err) {
    console.error("Slack event error:", err);
    return res.status(500).send("Server Error");
  }
}

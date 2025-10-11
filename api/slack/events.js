import { google } from "googleapis";
import dayjs from "dayjs";
import dotenv from "dotenv";

dotenv.config();

// Google Sheets setup
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

export const config = {
  api: {
    bodyParser: true, // ✅ raw-body は使わず通常パーサーを有効に
  },
};

export default async function handler(req, res) {
  // ✅ Slack の challenge 検証
  if (req.method === "POST" && req.body?.type === "url_verification") {
    console.log("✅ Slack challenge received");
    return res.status(200).send(req.body.challenge);
  }

  // ✅ イベント処理本体
  if (req.method === "POST" && req.body?.event) {
    const event = req.body.event;
    console.log("📩 Slack event:", event);

    if (event.type === "message" && !event.bot_id) {
      const text = event.text;
      const user = event.user;
      const now = dayjs().format("YYYY-MM-DD HH:mm:ss");

      const range = "A2:F";
      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range,
      });

      const rows = sheetData.data.values || [];
      const findRow = rows.findIndex((r) => r[1] === user);
      const getRow = (r = []) => ({
        team_id: r[0] || "",
        user_id: r[1] || user,
        user_name: r[2] || "",
        total: parseFloat(r[3] || 0),
        worked: parseFloat(r[4] || 0),
        last_action: r[5] || "",
      });

      const userRow = getRow(rows[findRow] || []);

      // メッセージパターンごとに処理
      if (text.includes("開始しますー")) {
        userRow.last_action = now;
      } else if (text.includes("抜けますー")) {
        userRow.break_start = now;
      } else if (text.includes("再開しますー")) {
        const breakTime =
          (dayjs(now).diff(dayjs(userRow.break_start), "minute") || 0) / 60;
        userRow.worked += breakTime;
        delete userRow.break_start;
      } else if (text.includes("終えますー")) {
        const totalWorked =
          (dayjs(now).diff(dayjs(userRow.last_action), "minute") || 0) / 60;
        userRow.worked += totalWorked;
        const remaining = (userRow.total - userRow.worked).toFixed(2);
        console.log(
          `👤 ${user} worked ${totalWorked}h (remaining ${remaining}h)`
        );
      }

      // 更新 or 追記
      const values = [
        [
          userRow.team_id,
          userRow.user_id,
          userRow.user_name,
          userRow.total,
          userRow.worked,
          userRow.last_action,
        ],
      ];

      if (findRow >= 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `A${findRow + 2}:F${findRow + 2}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: "A2",
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        });
      }
    }

    return res.status(200).send("OK");
  }

  return res.status(405).send("Method Not Allowed");
}

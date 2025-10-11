import { google } from "googleapis";
import dayjs from "dayjs";
import dotenv from "dotenv";
import getRawBody from "raw-body";
dotenv.config();

// Google Sheets 認証
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

export const config = {
  api: {
    bodyParser: false, // Slackの署名検証には必要
  },
};

export default async function handler(req, res) {
  try {
    // ✅ Slackのイベントサブスクリプション検証
    if (req.method === "POST") {
      const rawBody = await getRawBody(req);
      const body = JSON.parse(rawBody.toString());

      // SlackからのURL検証イベント
      if (body.type === "url_verification") {
        console.log("✅ Slack challenge verification received");
        return res.status(200).send(body.challenge);
      }

      // 通常のメッセージイベント
      if (body.event && body.event.type === "message" && !body.event.bot_id) {
        const text = body.event.text;
        const user = body.event.user;
        const now = dayjs().format("YYYY-MM-DD HH:mm:ss");

        console.log(`💬 message received: ${text} from ${user}`);

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

        // 状態更新（開始／抜ける／再開／終えます）
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
  } catch (error) {
    console.error("Slack event error:", error);
    return res.status(500).send("Internal Server Error");
  }
}

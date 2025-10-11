import { google } from "googleapis";
import dayjs from "dayjs";
import { parse } from "querystring";

export const config = {
  api: {
    bodyParser: false, // Slack互換
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // Slackはapplication/x-www-form-urlencoded形式でPOSTしてくる
  let rawBody = "";
  req.on("data", (chunk) => (rawBody += chunk.toString()));
  await new Promise((resolve) => req.on("end", resolve));

  const payload = parse(rawBody);
  const { command, text, user_id, user_name, team_id } = payload;

  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;

    const range = "A2:F";
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });

    const rows = sheetData.data.values || [];
    const findRow = rows.findIndex((r) => r[1] === user_id);

    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const getRow = (r = []) => ({
      team_id: r[0] || team_id,
      user_id: r[1] || user_id,
      user_name: r[2] || user_name,
      total: parseFloat(r[3] || 0),
      worked: parseFloat(r[4] || 0),
    });

    const user = getRow(rows[findRow] || []);

    if (command === "/setworktime") {
      const total = parseFloat(text);
      user.total = total;
      user.worked = 0;
    }

    if (command === "/addworktime") {
      const add = parseFloat(text);
      user.worked += add;
    }

    const values = [
      [user.team_id, user.user_id, user.user_name, user.total, user.worked, now],
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

    if (command === "/remaining") {
      const remaining = (user.total - user.worked).toFixed(2);
      return res.send(
        `📊 <@${user_id}> 残り: *${remaining}h* (合計${user.total}h / 消化${user.worked}h)`
      );
    }

    if (command === "/teamremaining") {
      const totalSum = rows.reduce((sum, r) => sum + parseFloat(r[3] || 0), 0);
      const workedSum = rows.reduce((sum, r) => sum + parseFloat(r[4] || 0), 0);
      const remainingSum = (totalSum - workedSum).toFixed(2);
      return res.send(
        `🏢 チーム全体 残り: *${remainingSum}h* (合計${totalSum}h / 消化${workedSum}h)`
      );
    }

    return res.send(
      `✅ <@${user_id}> 更新しました (合計${user.total}h / 消化${user.worked}h)`
    );
  } catch (err) {
    console.error("❌ Slack command error:", err);
    return res.status(500).send(`Error: ${err.message}`);
  }
}

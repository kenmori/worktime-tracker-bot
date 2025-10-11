import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";
import dayjs from "dayjs";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Google Sheets セットアップ
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// =============================
// Slackコマンド受付
// =============================
app.post("/api/slack/commands", async (req, res) => {
  const { command, text, user_id, user_name, team_id } = req.body;
  const now = dayjs().format("YYYY-MM-DD HH:mm:ss");

  // ---------- WorkSummary ----------
  const summaryRange = "WorkSummary!A2:F";
  const summarySheet = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: summaryRange,
  });
  const rows = summarySheet.data.values || [];
  const findRow = rows.findIndex((r) => r[1] === user_id);

  const getUserRow = (r = []) => ({
    team_id: r[0] || team_id,
    user_id: r[1] || user_id,
    user_name: r[2] || user_name,
    total: parseFloat(r[3] || 0),
    worked: parseFloat(r[4] || 0),
  });
  const user = getUserRow(rows[findRow] || []);

  // ===============================
  // ① /setworktime
  // ===============================
  if (command === "/setworktime") {
    const total = parseFloat(text);
    user.total = total;
    user.worked = 0;

    const values = [[user.team_id, user.user_id, user.user_name, user.total, 0, now]];
    if (findRow >= 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `WorkSummary!A${findRow + 2}:F${findRow + 2}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: summaryRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
    }
    return res.send(`✅ <@${user_id}> 月の稼働時間を *${user.total}h* に設定しました。`);
  }

  // ===============================
  // ② /addworktime
  // ===============================
  if (command === "/addworktime") {
    const add = parseFloat(text);
    user.worked += add;

    const values = [[user.team_id, user.user_id, user.user_name, user.total, user.worked, now]];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `WorkSummary!A${findRow + 2}:F${findRow + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    const remaining = (user.total - user.worked).toFixed(2);
    return res.send(`📈 <@${user_id}> ${add}h 追加しました。残り: *${remaining}h*`);
  }

  // ===============================
  // ③ /remaining
  // ===============================
  if (command === "/remaining") {
    const remaining = (user.total - user.worked).toFixed(2);
    return res.send(`📊 <@${user_id}> 残り: *${remaining}h* (合計${user.total}h / 消化${user.worked}h)`);
  }

  // ===============================
  // ④ /teamremaining
  // ===============================
  if (command === "/teamremaining") {
    const totalSum = rows.reduce((sum, r) => sum + parseFloat(r[3] || 0), 0);
    const workedSum = rows.reduce((sum, r) => sum + parseFloat(r[4] || 0), 0);
    const remainingSum = (totalSum - workedSum).toFixed(2);
    return res.send(`🏢 チーム全体 残り: *${remainingSum}h* (合計${totalSum}h / 消化${workedSum}h)`);
  }

  // ===============================
  // ⑤ /summary
  // ===============================
  if (command === "/summary") {
    const lines = rows.map((r) => {
      const name = r[2] || "unknown";
      const total = parseFloat(r[3] || 0);
      const worked = parseFloat(r[4] || 0);
      const remaining = (total - worked).toFixed(2);
      return `• ${name}: 残り *${remaining}h*（${worked}/${total}h）`;
    });
    return res.send(`📋 チーム稼働サマリー:\n${lines.join("\n")}`);
  }

  // ===============================
  // ⑥ /statusall
  // ===============================
  if (command === "/statusall") {
    const logRange = "WorkLogs!H2:M";
    const logSheet = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: logRange,
    });
    const rows = logSheet.data.values || [];

    // ユーザーごとに最新状態を取得
    const latest = {};
    rows.forEach((r) => {
      latest[r[0]] = r;
    });

    const working = [];
    const breaking = [];
    Object.values(latest).forEach((r) => {
      const state = r[5];
      const name = r[0];
      if (state === "working") working.push(name);
      if (state === "break") breaking.push(name);
    });

    const msg = [
      `💼 稼働中: ${working.length ? working.join(", ") : "なし"}`,
      `☕️ 休憩中: ${breaking.length ? breaking.join(", ") : "なし"}`,
    ].join("\n");
    return res.send(msg);
  }

  return res.send("❓ 未対応のコマンドです。");
});

// =============================
// Express 起動
// =============================
app.listen(3000, () => console.log("⚡️ Worktime Bot running on port 3000"));

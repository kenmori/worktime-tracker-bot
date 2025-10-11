export const config = {
  api: {
    bodyParser: false, // Slackのchallenge検証に必要
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // Slackリクエストの生データ取得
    const rawBody = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk.toString()));
      req.on("end", () => resolve(data));
    });

    const body = JSON.parse(rawBody || "{}");

    // ✅ チャレンジ検証（Slackが最初に送ってくる）
    if (body.type === "url_verification") {
      console.log("✅ Slack challenge received:", body.challenge);
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).end(body.challenge);
    }

    // ✅ 通常メッセージイベント
    if (body.event && body.event.type === "message" && !body.event.bot_id) {
      const text = body.event.text;
      const user = body.event.user;
      console.log("💬 Message received:", text);

      if (text.includes("開始しますー")) {
        console.log("🕒 開始しました:", user);
      } else if (text.includes("抜けますー")) {
        console.log("☕️ 休憩開始:", user);
      } else if (text.includes("再開しますー")) {
        console.log("💪 休憩終了:", user);
      } else if (text.includes("終えますー")) {
        console.log("🏁 終了:", user);
      } else {
        console.log("📨 それ以外のメッセージ:", text);
      }

      return res.status(200).send("OK");
    }

    return res.status(200).send("No event found");
  } catch (error) {
    console.error("❌ Slack events error:", error);
    return res.status(500).send("Internal Server Error");
  }
}

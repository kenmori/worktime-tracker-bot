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

    // Slack からの challenge 検証を確実にキャッチ
    const rawBody = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });

    const body = JSON.parse(rawBody || "{}");

    // ✅ URL Verification 対応
    if (body.type === "url_verification") {
      console.log("✅ Slack challenge received");
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(body.challenge);
    }

    // ✅ 通常イベント
    if (body.event) {
      console.log("📩 Received Slack event:", body.event.type);
      return res.status(200).send("OK");
    }

    return res.status(200).send("No event found");
  } catch (error) {
    console.error("❌ Slack events error:", error);
    return res.status(500).send("Internal Server Error");
  }
}

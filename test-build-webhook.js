require("dotenv").config();
const axios = require("axios");

function mask(url) {
  if (!url) return "undefined";
  return `${url.slice(0, 35)}...${url.slice(-18)}`;
}

async function main() {
  const url = process.env.SLACK_BUILD_WEBHOOK_URL;

  console.log("Loaded build webhook:", mask(url));

  try {
    const res = await axios.post(url, {
      text: "Test message to ct-build-log from build logger",
    });

    console.log("Success:", res.status);
  } catch (err) {
    console.log("Failed status:", err.response?.status);
    console.log("Failed data:", err.response?.data);
  }
}

main();
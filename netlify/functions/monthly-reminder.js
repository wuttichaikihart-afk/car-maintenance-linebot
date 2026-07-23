const { schedule } = require('@netlify/functions');
const line = require('@line/bot-sdk');
const db = require('../../src/services/db');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// Run on the 1st of every month at 9:00 AM (UTC+7 usually means we set UTC time, but Netlify uses UTC by default, so 02:00 UTC = 09:00 BKK)
// Cron syntax: minute hour day month day-of-week
module.exports.handler = schedule('0 2 1 * *', async (event) => {
  try {
    // Get all users
    const users = await db.user.findMany();

    const message = {
      type: 'text',
      text: 'สวัสดีครับ 🗓️ ได้เวลาอัปเดตข้อมูลรถประจำเดือนแล้วครับ!\n\nตอนนี้เลขไมล์รถของคุณอยู่ที่เท่าไหร่ครับ? (พิมพ์เฉพาะตัวเลขส่งมาได้เลยครับ)'
    };

    // Send push message to each user
    // Note: In production with many users, it's better to use multicast to send in batches of 500
    for (const user of users) {
      if (user.lineId) {
        await client.pushMessage(user.lineId, message);
      }
    }

    return {
      statusCode: 200,
      body: 'Reminders sent successfully'
    };
  } catch (error) {
    console.error('Error sending scheduled reminders:', error);
    return {
      statusCode: 500,
      body: 'Error sending reminders'
    };
  }
});

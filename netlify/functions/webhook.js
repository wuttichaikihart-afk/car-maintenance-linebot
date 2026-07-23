const { messagingApi } = require('@line/bot-sdk');
const crypto = require('crypto');
const db = require('../../src/services/db');
const { checkMaintenanceRules } = require('../../src/services/maintenance');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

exports.handler = async (event, context) => {
  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify LINE signature
  const signature = event.headers['x-line-signature'];
  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  
  const hash = crypto
    .createHmac('SHA256', config.channelSecret)
    .update(body)
    .digest('base64');

  if (hash !== signature) {
    console.error('Signature verification failed');
    return { statusCode: 401, body: 'Signature verification failed' };
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    console.error('Failed to parse JSON body:', e);
    return { statusCode: 400, body: 'Bad Request' };
  }

  try {
    // Process all events
    await Promise.all(data.events.map(handleEvent));
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

async function handleEvent(event) {
  const userId = event.source.userId;

  // Handle follow event (user adds bot as friend)
  if (event.type === 'follow') {
    // Check if user exists
    let user = await db.user.findUnique({ where: { lineId: userId } });
    if (!user) {
      // Get profile to save name
      const profile = await client.getProfile(userId);
      user = await db.user.create({
        data: {
          lineId: userId,
          name: profile.displayName,
          cars: {
            create: {
              licensePlate: 'รถของคุณ', // Default car name
              currentMileage: 0
            }
          }
        }
      });
    }

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `สวัสดีครับคุณ ${user.name} ยินดีต้อนรับสู่ระบบแจ้งเตือนการบำรุงรักษารถยนต์!\nคุณสามารถพิมพ์ตัวเลขเพื่ออัปเดตเลขไมล์รถได้เลยครับ เช่น "50000"`
      }]
    });
  }

  // Handle text messages
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();
    
    // Check if the message is a number (mileage update)
    const mileageMatch = text.match(/^[\d,]+$/);
    if (mileageMatch) {
      const mileage = parseInt(text.replace(/,/g, ''), 10);
      
      const user = await db.user.findUnique({
        where: { lineId: userId },
        include: { cars: true }
      });

      if (!user || user.cars.length === 0) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: 'ไม่พบข้อมูลรถของคุณในระบบ โปรดลองแอดบอทใหม่อีกครั้ง'
          }]
        });
      }

      // We assume user has 1 car for simplicity
      const car = user.cars[0];

      if (mileage < car.currentMileage) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: `เลขไมล์ที่แจ้ง (${mileage}) น้อยกว่าเลขไมล์ปัจจุบันในระบบ (${car.currentMileage})\nโปรดตรวจสอบและแจ้งใหม่อีกครั้งครับ`
          }]
        });
      }

      // Update mileage
      await db.car.update({
        where: { id: car.id },
        data: { currentMileage: mileage }
      });

      // Check for maintenance rules
      const alerts = await checkMaintenanceRules(car.id, mileage);
      
      let replyText = `อัปเดตเลขไมล์เป็น ${mileage.toLocaleString()} กม. เรียบร้อยแล้วครับ`;

      if (alerts.length > 0) {
        replyText += `\n\n⚠️ **แจ้งเตือนการบำรุงรักษา:**`;
        alerts.forEach(alert => {
          replyText += `\n- ${alert.item} (เกินระยะมาแล้ว ${alert.overdue.toLocaleString()} กม.)`;
        });
        replyText += `\n\nอย่าลืมนำรถเข้าศูนย์เพื่อเช็คสภาพนะครับ!`;
      } else {
        replyText += `\n\n✅ รถของคุณยังอยู่ในระยะปกติ ยังไม่มีรายการที่ต้องบำรุงรักษาครับ`;
      }

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: replyText
        }]
      });
    }

    // Default reply if it's not a number
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: 'หากต้องการอัปเดตเลขไมล์ กรุณาพิมพ์เฉพาะตัวเลขครับ เช่น 50000'
      }]
    });
  }

  // Return a resolved promise for unhandled events
  return Promise.resolve(null);
}

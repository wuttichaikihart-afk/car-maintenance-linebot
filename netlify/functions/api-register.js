const db = require('../../src/services/db');
const { messagingApi } = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const { lineId, brand, model, licensePlate, currentMileage } = data;

    if (!lineId || !brand || !model || !licensePlate || currentMileage === undefined) {
        return { statusCode: 400, body: 'Missing required fields' };
    }

    // Upsert User and Car
    let user = await db.user.findUnique({
      where: { lineId },
      include: { cars: true }
    });

    if (user) {
      if (user.cars.length > 0) {
        // Update existing car
        await db.car.update({
          where: { id: user.cars[0].id },
          data: {
            brand,
            model,
            licensePlate,
            currentMileage
          }
        });
      } else {
        // Create new car for existing user
        await db.car.create({
          data: {
            userId: user.id,
            brand,
            model,
            licensePlate,
            currentMileage
          }
        });
      }
    } else {
      // Create new user and car
      // We will try to fetch the profile from LINE, if it fails, fallback to empty name
      let name = 'ผู้ใช้';
      try {
        const profile = await client.getProfile(lineId);
        name = profile.displayName;
      } catch (e) {
        console.error('Could not fetch LINE profile', e);
      }

      await db.user.create({
        data: {
          lineId,
          name,
          cars: {
            create: {
              brand,
              model,
              licensePlate,
              currentMileage
            }
          }
        }
      });
    }

    // Send confirmation message to LINE
    try {
      await client.pushMessage({
        to: lineId,
        messages: [{
          type: 'text',
          text: `✅ ลงทะเบียนรถยนต์สำเร็จ!\n\n🚘 รถของคุณ: ${brand} ${model}\n🪧 ทะเบียน: ${licensePlate}\n🛣️ เลขไมล์: ${currentMileage.toLocaleString()} กม.\n\nตั้งแต่นี้ไป แค่พิมพ์เลขไมล์ส่งมาหาเรา AI จะช่วยเตือนการบำรุงรักษาให้ตรงกับรุ่นรถของคุณโดยเฉพาะครับ! 🤖`
        }]
      });
    } catch (e) {
      console.error('Failed to send LINE push message', e);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Registration successful' })
    };

  } catch (error) {
    console.error('Error in api-register:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

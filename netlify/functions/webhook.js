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
      
      let user = await db.user.findUnique({
        where: { lineId: userId },
        include: { cars: true }
      });

      // Auto-register if the user was missed during the 'follow' event
      if (!user) {
        try {
          const profile = await client.getProfile(userId);
          user = await db.user.create({
            data: {
              lineId: userId,
              name: profile.displayName,
              cars: {
                create: {
                  licensePlate: 'รถของคุณ',
                  currentMileage: 0
                }
              }
            },
            include: { cars: true }
          });
        } catch (e) {
          console.error('Failed to auto-register user:', e);
        }
      }

      if (!user || user.cars.length === 0) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: 'ระบบกำลังมีปัญหาในการสร้างข้อมูล โปรดลองใหม่อีกครั้งในภายหลังครับ'
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

      // Setup Gemini AI
      let replyText = `อัปเดตเลขไมล์เป็น ${mileage.toLocaleString()} กม. เรียบร้อยแล้วครับ`;

      if (process.env.GEMINI_API_KEY && car.brand && car.model) {
        try {
          const { GoogleGenAI } = require('@google/genai');
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          
          const prompt = `ทำหน้าที่เป็นช่างซ่อมรถยนต์ผู้เชี่ยวชาญและใจดี ตอบกลับสั้นๆ กระชับ
ข้อมูลรถ: ${car.brand} ${car.model}
เลขไมล์ปัจจุบัน: ${mileage} กม.

คำถาม: ตามมาตรฐานคู่มือการบำรุงรักษารถรุ่นนี้ ที่ระยะทางประมาณนี้ มีรายการอะไหล่หรือของเหลวอะไรบ้างที่ควรตรวจเช็คหรือเปลี่ยน? 
ข้อกำหนด: 
- ตอบเป็นข้อๆ สั้นๆ อ่านง่าย (เหมาะสำหรับแอปแชท LINE)
- ไม่ต้องอารัมภบทเยอะ
- ถ้าเลขไมล์น้อยมาก (เช่น เพิ่งออกรถ) ให้บอกว่ายังไม่ต้องทำอะไร แค่เช็คลมยาง/น้ำมันเครื่องพื้นฐาน
- ถ้ามีอะไรสำคัญให้เน้นย้ำ
- ลงท้ายด้วยคำแนะนำห่วงใยสั้นๆ`;

          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
          });

          const aiAdvice = response.text;
          replyText += `\n\n🤖 **คำแนะนำจากช่าง AI:**\n${aiAdvice}`;

        } catch (e) {
          console.error('Failed to get Gemini response:', e);
          replyText += `\n\n(AI กำลังพักผ่อนอยู่ตอนนี้ โปรดเช็ครายการบำรุงรักษาจากคู่มือรถของคุณนะครับ)`;
        }
      } else {
        // Fallback or missing data
        if (!car.brand || !car.model) {
          replyText += `\n\n💡 บอทยังไม่ทราบยี่ห้อและรุ่นรถของคุณ เลยยังให้คำแนะนำที่แม่นยำไม่ได้ครับ ลองลงทะเบียนข้อมูลรถของคุณผ่านเมนูด้านล่างดูนะครับ!`;
        } else {
          replyText += `\n\n(กำลังรอการตั้งค่าระบบ AI แจ้งเตือนอัจฉริยะ)`;
        }
      }

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: replyText
        }]
      });
    }

    // If the message is not a number, let AI handle it as a question!
    try {
      let user = await db.user.findUnique({
        where: { lineId: userId },
        include: { cars: true }
      });
      const car = user && user.cars.length > 0 ? user.cars[0] : null;

      if (process.env.GEMINI_API_KEY) {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        
        let context = "";
        if (car && car.brand && car.model) {
            context = `ข้อมูลผู้ใช้: ขับรถ ${car.brand} ${car.model} เลขไมล์ปัจจุบัน ${car.currentMileage} กม.`;
        }

        const prompt = `ทำหน้าที่เป็นช่างซ่อมรถยนต์ผู้เชี่ยวชาญและใจดี ตอบคำถามลูกค้า
${context}
คำถามจากลูกค้า: "${text}"

ข้อกำหนด: 
- ตอบสั้นๆ กระชับ เป็นกันเอง (เหมาะสำหรับแอปแชท LINE)
- ถ้าลูกค้าถามเรื่องการบำรุงรักษา ให้ตอบตามมาตรฐานรถของเขา
- ถ้าลูกค้าคุยเล่น ก็คุยเล่นตอบได้เลยในฐานะช่าง`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });

        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: response.text
          }]
        });
      } else {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: 'หากต้องการอัปเดตเลขไมล์ กรุณาพิมพ์เฉพาะตัวเลขครับ เช่น 50000\n(หรือหากต้องการคุยกับ AI ช่างยนต์ โปรดตั้งค่า GEMINI_API_KEY ก่อนครับ)'
          }]
        });
      }
    } catch (e) {
      console.error('Failed to get Gemini response for chat:', e);
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: 'หากต้องการอัปเดตเลขไมล์ กรุณาพิมพ์เฉพาะตัวเลขครับ เช่น 50000'
        }]
      });
    }
  }

  // Return a resolved promise for unhandled events
  return Promise.resolve(null);
}

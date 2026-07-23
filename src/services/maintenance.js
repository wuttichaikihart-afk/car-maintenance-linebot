const db = require('./db');

/**
 * ตรวจสอบว่ารถถึงระยะบำรุงรักษาอะไรบ้าง
 * @param {string} carId 
 * @param {number} currentMileage 
 * @returns {Promise<Array>} รายการที่ต้องบำรุงรักษา
 */
async function checkMaintenanceRules(carId, currentMileage) {
  const alerts = [];
  
  // ดึงกฎทั้งหมด
  const rules = await db.maintenanceRule.findMany();
  
  // ดึงประวัติของรถคันนี้ล่าสุด
  const records = await db.maintenanceRecord.findMany({
    where: { carId },
    orderBy: { date: 'desc' }
  });

  for (const rule of rules) {
    // หา record ล่าสุดของรายการนี้
    const lastRecord = records.find(r => r.item === rule.item);
    
    if (lastRecord) {
      // ถ้าเคยทำมาแล้ว ให้ดูระยะจากครั้งล่าสุด
      const milesSinceLast = currentMileage - lastRecord.mileageAtTime;
      if (milesSinceLast >= rule.intervalMileage) {
        alerts.push({
          item: rule.item,
          overdue: milesSinceLast - rule.intervalMileage,
          rule: rule.intervalMileage
        });
      }
    } else {
      // ถ้ายัังไม่เคยทำเลย ให้ดูว่า currentMileage ถึงเกณฑ์หรือยัง
      // สมมติว่าถ้าเกิน interval ไปแล้วให้เตือนเลย
      if (currentMileage >= rule.intervalMileage) {
         alerts.push({
          item: rule.item,
          overdue: currentMileage - rule.intervalMileage,
          rule: rule.intervalMileage
        });
      }
    }
  }

  return alerts;
}

module.exports = {
  checkMaintenanceRules
};

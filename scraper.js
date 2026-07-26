const { chromium } = require('playwright');
const fs = require('fs');

// 🎯 Official List of HK Sushiro Branches (Guarantees ZERO Garbage/UI Entries)
const HK_STORES = [
  "黃埔享膳坊店", "黃埔時尚坊店", "佐敦薈店", "尖沙咀加連威老道店", "旺角店",
  "啟德零售館2店", "旺角東Moko店", "奧海城 2 期店", "九龍灣德福廣場2期店", "新蒲崗Mikiki店",
  "九龍灣淘大店", "樂富店", "觀塘店", "南昌V-Walk店", "黃大仙店", "藍田店",
  "油塘店", "荔枝角店", "寶琳店", "將軍澳廣場店", "坑口店", "康城店",
  "沙田新城市廣場3期店", "葵芳店", "沙田中心店", "禾輋店", "荃灣綠楊店",
  "青衣城1期店", "荃灣廣場店", "馬鞍山店", "大埔店", "太和廣場店", "粉嶺中心店",
  "元朗廣場店", "上水匯店", "元朗千色匯店", "屯門市廣場店", "屯門華都店", "天水圍 T Town店",
  "北角匯2期店", "銅鑼灣廣場2期店", "鰂魚涌店", "上環店", "香港仔利港商場店"
];

(async () => {
  console.log("Starting Sushiro Scraper (Store Whitelist Strategy)...");
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  try {
    console.log("Loading Sushiro web app...");
    await page.goto('https://sushirolic.web.app/desktop.html', { waitUntil: 'networkidle', timeout: 60000 });
    
    // Wait 5 seconds for live Firebase API data to load
    await page.waitForTimeout(5000);

    // Scroll page to force lazy-loaded cards into the DOM
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 800));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 400));
    });

    const outlets = [];

    for (let i = 0; i < HK_STORES.length; i++) {
      const storeName = HK_STORES[i];
      
      try {
        // Target the specific element for this exact store name
        const card = page.locator('div, li, button, article').filter({ hasText: storeName }).last();
        
        if (await card.count() > 0) {
          const cardText = await card.innerText().catch(() => '');

          const groupMatch = cardText.match(/(\d+)\s*組/);
          const timeMatch = cardText.match(/(\d+)\s*分鐘/);
          const groups = groupMatch ? parseInt(groupMatch[1], 10) : 0;
          const waitTime = timeMatch ? parseInt(timeMatch[1], 10) : 0;

          let recentCalls = [];

          if (groups > 0) {
            try {
              await card.click({ force: true, timeout: 1200 });
              await page.waitForTimeout(300);

              const panelText = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('div, section, aside, [class*="detail"], [class*="right"], [class*="drawer"]'));
                const panel = elements.find(el => {
                  const rect = el.getBoundingClientRect();
                  return rect.left > 300 && rect.width > 200 && el.innerText && el.innerText.length > 10;
                });
                return panel ? panel.innerText : '';
              });

              if (panelText) {
                const rawMatches = panelText.match(/\b([A-Z]?\d{3})\b/gi) || [];
                recentCalls = [...new Set(rawMatches.map(m => m.toUpperCase()))].filter(num => {
                  const val = parseInt(num.replace(/\D/g, ''), 10);
                  return val >= 1 && val <= 999 && val !== groups && val !== waitTime;
                });
              }
            } catch (e) {
              // Fallback
            }
          }

          if (groups === 0) {
            recentCalls = ['即時入座'];
          } else if (recentCalls.length === 0) {
            recentCalls = ['叫號中'];
          }

          outlets.push({
            id: outlets.length + 1,
            name_tc: storeName,
            region: 'KLN',
            waiting_groups: groups,
            wait_time: waitTime,
            address: '香港壽司郎分店',
            current_number: recentCalls[0],
            recent_calls: recentCalls.slice(0, 3)
          });
        }
      } catch (e) {
        console.log(`Error processing ${storeName}`);
      }
    }

    const payload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: outlets
    };

    fs.writeFileSync('live_data.json', JSON.stringify(payload, null, 2));
    console.log(`Successfully saved ${outlets.length} stores to live_data.json`);

  } catch (err) {
    console.error("Scraper Error:", err);
  } finally {
    await browser.close();
  }
})();

// scraper.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper (Clean Grid + Outlet Details)...");

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  try {
    console.log("Navigating to queue page...");
    await page.goto('https://sushirolic.web.app/desktop.html', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await page.waitForTimeout(4000);

    const ignoreNames = ['列表', '九龍', '新界', '港島', '即時排隊', '壽司郎', '點選左邊分店'];

    // Find all store card elements
    const allCards = await page.locator('div, li, button, article').filter({ hasText: /店/ }).all();
    
    const storeItems = [];
    const seenNames = new Set();

    for (const card of allCards) {
      const text = await card.innerText().catch(() => '');
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      const nameLine = lines.find(l => l.includes('店') && !ignoreNames.some(ign => l.includes(ign)) && l.length < 25);

      if (nameLine && !seenNames.has(nameLine) && (text.includes('組') || text.includes('分鐘'))) {
        seenNames.add(nameLine);
        storeItems.push({ locator: card, name: nameLine, text: text });
      }
    }

    console.log(`Extracting store details for ${storeItems.length} locations...`);

    const outlets = [];

    for (let i = 0; i < storeItems.length; i++) {
      const item = storeItems[i];
      const groupMatch = item.text.match(/(\d+)\s*組/);
      const timeMatch = item.text.match(/(\d+)\s*分鐘/);

      const groups = groupMatch ? parseInt(groupMatch[1]) : 0;
      const waitTime = timeMatch ? parseInt(timeMatch[1]) : 0;

      let address = '香港壽司郎分店';
      let callingNumber = groups === 0 ? '即時入座' : '叫號中';

      try {
        // Native click to open store detail view
        await item.locator.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(400);

        const detailText = await page.evaluate(() => {
          const panel = document.querySelector('[class*="detail"], [class*="right"], [class*="drawer"], [class*="sidebar"]') || document.body;
          return panel.innerText || '';
        });

        const lines = detailText.split('\n').map(s => s.trim()).filter(Boolean);

        // Extract store address / shop unit line
        const addrLine = lines.find(l => (l.includes('舖') || l.includes('樓') || l.includes('層') || l.includes('道') || l.includes('街') || l.includes('中心') || l.includes('廣場')) && !l.includes('等候') && !l.includes('分鐘') && !l.includes('組'));
        if (addrLine && addrLine.length > 5) {
          address = addrLine;
        }

        // Extract calling ticket if available in detail view
        if (groups > 0) {
          const ticketMatch = detailText.match(/(?:現正叫號|叫號|堂食|籌號|叫至)[^\n]*?([A-Za-z]?\s*\d{1,4})/i);
          if (ticketMatch && ticketMatch[1]) {
            callingNumber = ticketMatch[1].trim();
          }
        }
      } catch (e) {
        // Fallback safely
      }

      outlets.push({
        id: i + 1,
        name_tc: item.name,
        region: 'KLN', // Region mapping handled on Blogger frontend
        waiting_groups: groups,
        wait_time: waitTime,
        address: address,
        current_number: callingNumber
      });
    }

    const finalPayload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: outlets
    };

    fs.writeFileSync('live_data.json', JSON.stringify(finalPayload, null, 2));
    console.log(`Successfully generated live_data.json with ${outlets.length} stores!`);

  } catch (err) {
    console.error("Scraper Error:", err.message);
    fs.writeFileSync('live_data.json', JSON.stringify({
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: []
    }, null, 2));
  } finally {
    await browser.close();
  }
})();

// scraper.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper (Extracting Recent 3 Numbers)...");

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
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

    console.log(`Extracting details for ${storeItems.length} locations...`);

    const outlets = [];

    for (let i = 0; i < storeItems.length; i++) {
      const item = storeItems[i];
      const groupMatch = item.text.match(/(\d+)\s*組/);
      const timeMatch = item.text.match(/(\d+)\s*分鐘/);

      const groups = groupMatch ? parseInt(groupMatch[1]) : 0;
      const waitTime = timeMatch ? parseInt(timeMatch[1]) : 0;

      let address = '香港壽司郎分店';
      let callingNumber = groups === 0 ? '即時入座' : '叫號中';
      let recentCalls = [];

      try {
        // Click store to open side detail panel
        await item.locator.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(400);

        const detailText = await page.evaluate(() => {
          const panel = document.querySelector('[class*="detail"], [class*="right"], [class*="drawer"], [class*="sidebar"]') || document.body;
          return panel.innerText || '';
        });

        // 🎫 Extract ticket/calling numbers (e.g. A123, B045, 1024)
        if (groups > 0) {
          const rawMatches = detailText.match(/[A-Za-z]?\s*\d{2,4}/gi) || [];
          const filteredCalls = [...new Set(rawMatches.map(m => m.replace(/\s+/g, '').toUpperCase()))]
            .filter(num => num != groups && num != waitTime && !num.includes('店'));

          if (filteredCalls.length > 0) {
            recentCalls = filteredCalls.slice(0, 3);
            callingNumber = recentCalls[0];
          }
        }
      } catch (e) {
        // Safe fallback
      }

      // Fallback defaults for recent_calls array
      if (recentCalls.length === 0) {
        recentCalls = groups === 0 ? ['即時入座'] : [callingNumber || '叫號中'];
      }

      outlets.push({
        id: i + 1,
        name_tc: item.name,
        region: 'KLN',
        waiting_groups: groups,
        wait_time: waitTime,
        address: address,
        current_number: callingNumber,
        recent_calls: recentCalls // 👈 Passed directly to JSON!
      });
    }

    const finalPayload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: outlets
    };

    fs.writeFileSync('live_data.json', JSON.stringify(finalPayload, null, 2));
    console.log(`Successfully saved live_data.json with ${outlets.length} stores!`);

  } catch (err) {
    console.error("Scraper Error:", err.message);
  } finally {
    await browser.close();
  }
})();

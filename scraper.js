// scraper.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Playwright Scraper with strict ticket filtering...");

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

    await page.waitForTimeout(5000);

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

    console.log(`Processing ${storeItems.length} stores...`);

    const outlets = [];

    for (let i = 0; i < storeItems.length; i++) {
      const item = storeItems[i];
      const groupMatch = item.text.match(/(\d+)\s*組/);
      const timeMatch = item.text.match(/(\d+)\s*分鐘/);

      const groups = groupMatch ? parseInt(groupMatch[1]) : 0;
      const waitTime = timeMatch ? parseInt(timeMatch[1]) : 0;

      let callingNumber = '即時入座';
      let recentCalls = [];

      if (groups > 0) {
        try {
          // Native click to open store detail view
          await item.locator.click({ force: true, timeout: 2000 });
          await page.waitForTimeout(450);

          // Get raw text from the page
          const rawPageText = await page.evaluate(() => document.body.innerText || '');

          // ⚠️ KEY FIX: Strip out all wait times ("X 分鐘") and group counts ("X 組")
          // so digits from wait times are never mistaken for ticket numbers!
          const cleanedText = rawPageText
            .replace(/\d+\s*分鐘/g, '')
            .replace(/\d+\s*組/g, '')
            .replace(/更新時間[^\n]*/g, '');

          // Match authentic ticket patterns:
          // 1) Prefix format: A123, B045, G38, C-012
          // 2) Range format: 233-239, 176-177, 463-483
          const matches = cleanedText.match(/([A-Z]\s*[-_]?\s*\d{1,4}|\b\d{2,4}\s*[-~至]\s*\d{2,4}\b)/gi) || [];

          const validTickets = Array.from(new Set(
            matches.map(t => t.replace(/\s+/g, '').toUpperCase())
          )).filter(t => t.length >= 2);

          if (validTickets.length > 0) {
            callingNumber = validTickets[0];
            recentCalls = validTickets.slice(0, 3);
          } else {
            callingNumber = '叫號中';
            recentCalls = ['叫號中'];
          }
        } catch (e) {
          callingNumber = '叫號中';
          recentCalls = ['叫號中'];
        }
      } else {
        recentCalls = ['即時入座'];
      }

      outlets.push({
        id: i + 1,
        name_tc: item.name,
        region: 'KLN', // Region mapping handled on Blogger frontend
        current_number: callingNumber,
        recent_calls: recentCalls,
        waiting_groups: groups,
        wait_time: waitTime
      });
    }

    const finalPayload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: outlets
    };

    fs.writeFileSync('live_data.json', JSON.stringify(finalPayload, null, 2));
    console.log(`Successfully saved ${outlets.length} stores to live_data.json!`);

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

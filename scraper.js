// scraper.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Playwright Scraper with pure numeric ticket support...");

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

    // Locate store cards
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

          const rawPageText = await page.evaluate(() => document.body.innerText || '');

          // 1. Remove address & shop unit lines (e.g., "350-351號舖", "Shop 176")
          const linesWithoutAddress = rawPageText
            .split('\n')
            .filter(line => !/[舖Shop樓層地下地址電話營業]/i.test(line));

          const cleanPageText = linesWithoutAddress.join('\n')
            .replace(/\d+\s*分鐘/g, '')
            .replace(/\d+\s*組/g, '')
            .replace(/更新時間[^\n]*/g, '');

          // 2. Extract authentic ticket numbers/ranges (e.g., "263-267", "275", "105", "A101")
          const matches = cleanPageText.match(/(?:現正叫號|叫號|堂食|籌號|叫至)[^\n]*?([A-Za-z]?\s*\d{1,4}(?:\s*[-~至]\s*\d{1,4})?)/gi) ||
                          cleanPageText.match(/(\b[A-Za-z]?\d{1,4}\s*[-~至]\s*[A-Za-z]?\d{1,4}\b)/g) ||
                          cleanPageText.match(/(\b[A-Za-z]?\d{2,4}\b)/g) || [];

          const validTickets = Array.from(new Set(
            matches.map(t => t.replace(/(?:現正叫號|叫號|堂食|籌號|叫至)/gi, '').trim().replace(/\s+/g, ''))
          )).filter(t => t.length >= 1 && t !== String(groups) && t !== String(waitTime));

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
        region: 'KLN', // Auto-mapped on Blogger frontend
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

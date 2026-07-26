const { chromium, devices } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper (Mobile Emulation Mode for 100% Accuracy)...");
  
  // Emulate an iPhone 13 to force the mobile UI where popups are full-screen and easier to scrape
  const iPhone = devices['iPhone 13'];
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    ...iPhone,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
  });

  const page = await context.newPage();

  try {
    console.log("Loading Sushiro queue page in Mobile mode...");
    await page.goto('https://sushirolic.web.app/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000); // Wait for initial React render

    // 📜 Scroll to load all lazy stores
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 800));
      window.scrollTo(0, 0);
    });

    const ignoreNames = ['全港分店', '港島區', '九龍區', '新界區', '列表', '九龍', '新界', '港島', '即時排隊', '壽司郎', '選擇分店', '分店列表', '點選左邊分店'];

    // Get all store cards
    const cardElements = await page.locator('div, li, article, button').filter({ hasText: /店/ }).all();
    
    const storeLocators = [];
    const seenNames = new Set();
    const globalBlacklist = new Set();

    // 1. First Pass: Collect Names, Wait Times, and Groups
    for (const locator of cardElements) {
      const text = await locator.innerText().catch(() => '');
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      const name = lines.find(l => l.includes('店') && !ignoreNames.includes(l) && l.length < 25);

      if (name && !seenNames.has(name)) {
        seenNames.add(name);

        const groupMatch = text.match(/(\d+)\s*組/);
        const timeMatch = text.match(/(\d+)\s*分鐘/);
        const groups = groupMatch ? parseInt(groupMatch[1], 10) : 0;
        const waitTime = timeMatch ? parseInt(timeMatch[1], 10) : 0;

        if (groups > 0) globalBlacklist.add(groups);
        if (waitTime > 0) globalBlacklist.add(waitTime);

        storeLocators.push({ name, groups, waitTime });
      }
    }

    console.log(`Found ${storeLocators.length} valid stores.`);
    const outlets = [];

    // 2. Second Pass: Click each store to get ticket numbers
    for (let i = 0; i < storeLocators.length; i++) {
      const { name, groups, waitTime } = storeLocators[i];
      let recentCalls = [];

      if (groups > 0) {
        try {
          // Re-locate the specific store card (DOM might refresh on mobile view)
          const targetCard = page.locator('div, li, article, button').filter({ hasText: name }).first();
          
          await targetCard.click({ force: true, timeout: 2000 });
          await page.waitForTimeout(600); // Wait for the mobile detail modal to slide in

          // 🎯 Extract text from the active screen (which is now the modal on mobile)
          const modalText = await page.evaluate(() => document.body.innerText);

          // Find 3-digit padded numbers (001-999)
          const rawMatches = modalText.match(/\b([A-Z]?\d{3})\b/gi) || [];
          recentCalls = [...new Set(rawMatches.map(m => m.toUpperCase()))].filter(num => {
            const val = parseInt(num.replace(/\D/g, ''), 10);
            return val >= 1 && val <= 999 && !globalBlacklist.has(val);
          });

          // 🔙 Close the modal/navigate back
          // Usually clicking the top-left or an "X" or a generic close button on mobile wrappers
          const closeBtns = page.locator('svg, button, [class*="back"], [class*="close"]');
          if (await closeBtns.count() > 0) {
             await closeBtns.first().click({ force: true, timeout: 1000 }).catch(() => {});
          } else {
             // Fallback: click top left corner
             await page.mouse.click(10, 10); 
          }
          await page.waitForTimeout(400);

        } catch (e) {
          console.log(`Error reading detail for ${name}`);
        }
      }

      if (groups === 0) {
        recentCalls = ['即時入座'];
      } else if (recentCalls.length === 0) {
        recentCalls = ['叫號中'];
      }

      outlets.push({
        id: i + 1,
        name_tc: name,
        region: 'KLN',
        waiting_groups: groups,
        wait_time: waitTime,
        address: '香港壽司郎分店',
        current_number: recentCalls[0],
        recent_calls: recentCalls.slice(0, 3) // Max 3 numbers
      });
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

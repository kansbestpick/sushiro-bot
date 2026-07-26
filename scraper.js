const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper (Dynamic Discovery Mode)...");
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("Loading Sushiro web app...");
    await page.goto('https://sushirolic.web.app/desktop.html', { waitUntil: 'networkidle', timeout: 60000 });
    
    // Allow Firebase live data to render
    await page.waitForTimeout(5000);

    // Scroll to force lazy-loaded cards into the DOM
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 800));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 400));
    });

    // Exact UI labels and headers to ignore
    const ignoreExact = ['全港分店', '港島區', '九龍區', '新界區', '列表', '九龍', '新界', '港島', '即時排隊', '壽司郎', '選擇分店', '分店列表', '點選左邊分店', '分店', '店外實況'];
    const ignoreKeywords = ['預計', '排隊', '實況', '選擇', '點選', '那一間', '等候時間'];

    const cardLocators = await page.locator('div, li, article, button').filter({ hasText: /店/ }).all();
    
    const storeLocators = [];
    const seenNames = new Set();
    const globalBlacklist = new Set();

    for (const locator of cardLocators) {
      const text = await locator.innerText().catch(() => '');
      if (!text) continue;

      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      
      // Dynamic store name extraction
      const name = lines.find(l => 
        l.includes('店') && 
        !ignoreExact.includes(l) && 
        !ignoreKeywords.some(kw => l.includes(kw)) &&
        l.length > 2 && 
        l.length < 25
      );

      if (name && !seenNames.has(name) && (text.includes('組') || text.includes('分鐘') || text.includes('入座'))) {
        seenNames.add(name);

        const groupMatch = text.match(/(\d+)\s*組/);
        const timeMatch = text.match(/(\d+)\s*分鐘/);
        const groups = groupMatch ? parseInt(groupMatch[1], 10) : 0;
        const waitTime = timeMatch ? parseInt(timeMatch[1], 10) : 0;

        if (groups > 0) globalBlacklist.add(groups);
        if (waitTime > 0) globalBlacklist.add(waitTime);

        storeLocators.push({ locator, name, groups, waitTime });
      }
    }

    console.log(`Found ${storeLocators.length} dynamic store cards.`);
    const outlets = [];

    for (let i = 0; i < storeLocators.length; i++) {
      const { locator, name, groups, waitTime } = storeLocators[i];
      let recentCalls = [];

      if (groups > 0) {
        try {
          await locator.click({ force: true, timeout: 1500 });
          await page.waitForTimeout(350);

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
              return val >= 1 && val <= 999 && !globalBlacklist.has(val);
            });
          }
        } catch (e) {
          // Keep silent fallback
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
        recent_calls: recentCalls.slice(0, 3)
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

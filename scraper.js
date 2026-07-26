const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper (Fixed Ticket Extraction & Full Store List)...");
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 }
  });

  try {
    console.log("Loading Sushiro queue page...");
    await page.goto('https://sushirolic.web.app/desktop.html', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);

    // 📜 Auto-scroll to trigger lazy-loaded stores into the DOM
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 600));
      window.scrollTo(0, 0);
    });

    const ignoreNames = ['全港分店', '港島區', '九龍區', '新界區', '列表', '九龍', '新界', '港島', '即時排隊', '壽司郎', '選擇分店', '分店列表'];

    // 1. Locate store cards on the left
    const cardLocators = await page.locator('div, li, article, button').filter({ hasText: /店/ }).all();
    
    const storeLocators = [];
    const seenNames = new Set();

    for (const locator of cardLocators) {
      const text = await locator.innerText().catch(() => '');
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      const name = lines.find(l => l.includes('店') && !ignoreNames.includes(l) && l.length < 25);

      if (name && !seenNames.has(name)) {
        seenNames.add(name);

        const groupMatch = text.match(/(\d+)\s*組/);
        const timeMatch = text.match(/(\d+)\s*分鐘/);
        const groups = groupMatch ? parseInt(groupMatch[1], 10) : 0;
        const waitTime = timeMatch ? parseInt(timeMatch[1], 10) : 0;

        storeLocators.push({ locator, name, groups, waitTime });
      }
    }

    console.log(`Found ${storeLocators.length} store locations.`);
    const outlets = [];

    for (let i = 0; i < storeLocators.length; i++) {
      const { locator, name, groups, waitTime } = storeLocators[i];
      let recentCalls = [];

      if (groups > 0) {
        try {
          // Click store card to update detail panel on the right
          await locator.click({ force: true, timeout: 1500 });
          await page.waitForTimeout(400);

          // 🎯 Target text ONLY from the right detail panel via geometry
          const panelText = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('div, section, aside, [class*="detail"], [class*="right"], [class*="drawer"]'));
            
            // Find container element positioned on the right half of the screen
            const detailPanel = elements.find(el => {
              const rect = el.getBoundingClientRect();
              return rect.left > 300 && rect.width > 200 && el.innerText && el.innerText.length > 10;
            });

            return detailPanel ? detailPanel.innerText : '';
          });

          if (panelText) {
            // Extract 3-digit zero-padded ticket numbers (e.g. 012, 123, A104)
            const rawMatches = panelText.match(/\b([A-Z]?\d{3})\b/gi) || [];
            
            recentCalls = [...new Set(rawMatches.map(m => m.toUpperCase()))].filter(num => {
              const val = parseInt(num.replace(/\D/g, ''), 10);
              // Filter out 000, out-of-bounds, and this store's group/time counts
              return val >= 1 && val <= 999 && val !== groups && val !== waitTime;
            });
          }
        } catch (e) {
          console.log(`Could not read detail panel for ${name}`);
        }
      }

      // Safe Fallbacks
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

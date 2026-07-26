const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper (Including 九龍灣德福店 Fix)...");
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 }
  });

  try {
    console.log("Loading Sushiro queue page...");
    await page.goto('https://sushirolic.web.app/desktop.html', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);

    // Exact names/labels to ignore (header titles/buttons)
    const ignoreNames = ['列表', '九龍', '新界', '港島', '即時排隊', '壽司郎', '所有分店', '九龍區', '新界區', '港島區'];

    const cardLocators = await page.locator('div, li, article, button').filter({ hasText: /店/ }).all();
    
    const storeLocators = [];
    const seenNames = new Set();
    const globalBlacklist = new Set();

    for (const locator of cardLocators) {
      const text = await locator.innerText().catch(() => '');
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      
      // 🚨 FIX: Exact match against ignore list instead of substring match
      const name = lines.find(l => l.includes('店') && !ignoreNames.includes(l) && l.length < 25);

      if (name && !seenNames.has(name) && (text.includes('組') || text.includes('分鐘'))) {
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

    console.log(`Found ${storeLocators.length} stores.`);
    const outlets = [];

    for (let i = 0; i < storeLocators.length; i++) {
      const { locator, name, groups, waitTime } = storeLocators[i];
      let recentCalls = [];

      if (groups > 0) {
        try {
          await locator.click({ force: true, timeout: 1500 });
          await page.waitForTimeout(300);

          const modalText = await page.evaluate((storeName) => {
            const elements = Array.from(document.querySelectorAll('aside, [role="dialog"], [class*="drawer"], [class*="modal"], [class*="panel"], [class*="popup"]'));
            const matchedModal = elements.find(el => el.innerText && el.innerText.includes(storeName));
            return matchedModal ? matchedModal.innerText : '';
          }, name);

          if (modalText) {
            const rawMatches = modalText.match(/\b\d{3}\b/g) || [];
            recentCalls = [...new Set(rawMatches)].filter(num => {
              const val = parseInt(num, 10);
              return val >= 1 && val <= 999 && !globalBlacklist.has(val);
            });
          }
        } catch (e) {
          console.log(`Could not open modal for ${name}`);
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
    console.log(`Saved clean data for ${outlets.length} stores to live_data.json`);

  } catch (err) {
    console.error("Scraper Error:", err);
  } finally {
    await browser.close();
  }
})();

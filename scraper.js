const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper (With Auto-Scroll for Full Store List)...");
  
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

    // 📜 Auto-scroll to force lazy-loaded cards (like 九龍灣德福店) into the DOM
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 600));
      window.scrollTo(0, 0);
    });

    const ignoreNames = ['全港分店', '港島區', '九龍區', '新界區', '列表', '九龍', '新界', '港島', '即時排隊', '壽司郎', '選擇分店', '分店列表'];

    const cardLocators = await page.locator('div, li, article, button').filter({ hasText: /店/ }).all();
    
    const storeLocators = [];
    const seenNames = new Set();
    const globalBlacklist = new Set();

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
          await page.waitForTimeout(350);

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
    console.log(`Saved ${outlets.length} stores to live_data.json`);

  } catch (err) {
    console.error("Scraper Error:", err);
  } finally {
    await browser.close();
  }
})();

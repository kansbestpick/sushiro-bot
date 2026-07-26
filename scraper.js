const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper...");
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  try {
    console.log("Loading page...");
    await page.goto('https://sushirolic.web.app/desktop.html', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000); // Give it time to load data

    // Extract all data directly from the page
    const extractedData = await page.evaluate(() => {
      const ignoreNames = ['列表', '九龍', '新界', '港島', '即時排隊', '壽司郎'];
      // Find all store elements
      const cards = Array.from(document.querySelectorAll('div, li, article')).filter(el => el.innerText && el.innerText.includes('店'));
      
      const outlets = [];
      const seen = new Set();

      for (const card of cards) {
        const text = card.innerText;
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        const name = lines.find(l => l.includes('店') && !ignoreNames.some(ign => l.includes(ign)) && l.length < 20);

        if (name && !seen.has(name) && (text.includes('組') || text.includes('分鐘'))) {
          seen.add(name);
          
          const groupMatch = text.match(/(\d+)\s*組/);
          const timeMatch = text.match(/(\d+)\s*分鐘/);
          const groups = groupMatch ? parseInt(groupMatch[1]) : 0;
          const waitTime = timeMatch ? parseInt(timeMatch[1]) : 0;

          // 🎫 Attempt to find calling numbers (e.g., A123, 1024, B05)
          // It looks for sequences of numbers that aren't the group or wait time
          const rawNumbers = text.match(/\b[A-Z]?\d{2,4}\b/gi) || [];
          let recentCalls = [...new Set(rawNumbers)].filter(n => {
            const numVal = parseInt(n.replace(/[A-Z]/gi, ''));
            return numVal !== groups && numVal !== waitTime;
          });

          // Fallback if no specific ticket numbers are found
          if (recentCalls.length === 0) {
             recentCalls = groups === 0 ? ['即時入座'] : ['叫號中'];
          }

          outlets.push({
            name_tc: name,
            region: 'KLN', // Frontend categorizes this anyway
            waiting_groups: groups,
            wait_time: waitTime,
            address: '香港壽司郎分店',
            current_number: recentCalls[0] || '叫號中',
            recent_calls: recentCalls.slice(0, 3) // Ensures it passes an array of up to 3 numbers
          });
        }
      }
      return outlets;
    });

    // Add IDs and format payload
    const finalOutlets = extractedData.map((o, i) => ({ id: i + 1, ...o }));

    const payload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: finalOutlets
    };

    fs.writeFileSync('live_data.json', JSON.stringify(payload, null, 2));
    console.log(`Successfully saved ${finalOutlets.length} stores to live_data.json`);

  } catch (err) {
    console.error("Scraping failed:", err);
  } finally {
    await browser.close();
  }
})();

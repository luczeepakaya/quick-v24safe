const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('public/index.html', 'utf8');
console.log('HTML size:', html.length, 'bytes');

const $ = cheerio.load(html);
const inlineScripts = $('script:not([src])');
console.log('Inline scripts count:', inlineScripts.length);

let errors = 0;
inlineScripts.each((i, el) => {
  const type = $(el).attr('type');
  if (type === 'application/ld+json') return;
  const content = $(el).html();
  try {
    new Function(content);
    console.log(`Script #${i + 1} (${content.length} chars): OK`);
  } catch (err) {
    console.error(`Script #${i + 1} ERROR:`, err.message);
    errors++;
  }
});

console.log('Total syntax errors:', errors);

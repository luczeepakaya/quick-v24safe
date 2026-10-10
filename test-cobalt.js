async function testCobaltList() {
  try {
    const res = await fetch('https://instances.hyper.lol/api/instances', { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    console.log('Instances count:', json.length || Object.keys(json).length);
    const valid = json.filter ? json.filter(i => i.online && i.version >= 10).slice(0, 10) : json;
    console.log('Sample valid instances:', valid);
  } catch (e) {
    console.log('hyper.lol error:', e.message);
  }

  try {
    const res = await fetch('https://cobalt.directory/api/instances', { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    console.log('cobalt.directory count:', json.length || Object.keys(json).length);
  } catch (e) {
    console.log('cobalt.directory error:', e.message);
  }
}

testCobaltList();

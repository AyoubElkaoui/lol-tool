// Kijkt of er een nieuwere GitHub-release is. Alleen een melding met link: de Mac-build
// is niet gesigneerd, dus automatisch updaten kan daar niet.

const LATEST = "https://api.github.com/repos/AyoubElkaoui/lol-tool/releases/latest";

const parts = (v) => String(v).replace(/^v/, "").split(".").map(Number);
function isNewer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function check(current) {
  const r = await fetch(LATEST, { headers: { "User-Agent": "lol-tool", Accept: "application/vnd.github+json" } });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d?.tag_name || !isNewer(d.tag_name, current) || !/^https:\/\/github\.com\//.test(d.html_url || "")) return null;
  return { version: d.tag_name.replace(/^v/, ""), url: d.html_url };
}

module.exports = { check, isNewer };

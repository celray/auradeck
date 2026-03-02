/**
 * AuraDeck — Built-in Slide Templates
 *
 * Each template uses {{background}}, {{foreground}}, {{accent}}, {{secondary}}
 * placeholders that get resolved against the presentation's theme colors.
 */

// eslint-disable-next-line no-unused-vars
const SLIDE_TEMPLATES = [
  {
    name: "Blank",
    description: "Empty slide with base styles",
    preview: "Blank",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slide</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: {{background}}; }
  .slide {
    width: 100vw; height: 100vh;
    overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif;
    color: {{foreground}};
  }
</style>
</head>
<body>
<div class="slide">
</div>
</body>
</html>`
  },

  {
    name: "Title",
    description: "Centered title with subtitle and badge",
    preview: "Title + Subtitle",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slide - Title</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: {{background}}; }
  .slide {
    width: 100vw; height: 100vh;
    overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif;
    color: {{foreground}};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center;
  }
  h1 { font-size: 5vmin; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 2vmin; }
  h1 span { color: {{accent}}; }
  p.subtitle { font-size: 2.4vmin; color: #aaa; max-width: 60%; line-height: 1.6; }
  .badge {
    display: inline-block; margin-top: 3vmin; padding: 1vmin 3vmin;
    border: 2px solid {{accent}}; border-radius: 9999px;
    font-size: 1.8vmin; color: {{accent}}; letter-spacing: 0.1em; text-transform: uppercase;
    opacity: 0; animation: fadeUp 0.8s 0.6s forwards;
  }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  h1 { opacity: 0; animation: fadeUp 0.8s 0.1s forwards; }
  p.subtitle { opacity: 0; animation: fadeUp 0.8s 0.35s forwards; }
</style>
</head>
<body>
<div class="slide">
  <h1>Your <span>Title</span> Here</h1>
  <p class="subtitle">Add a subtitle or description for this slide.</p>
  <div class="badge">Label</div>
</div>
</body>
</html>`
  },

  {
    name: "Two Column",
    description: "Left text area with right image/content area",
    preview: "Text | Image",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slide - Two Column</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: {{background}}; }
  .slide {
    width: 100vw; height: 100vh;
    overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif;
    color: {{foreground}}; display: flex;
  }
  .left { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 6%; }
  .right { flex: 1; display: flex; align-items: center; justify-content: center; padding: 4%; }
  .right img { width: 85%; height: auto; border-radius: 12px; }
  .tag { font-size: 1.6vmin; text-transform: uppercase; letter-spacing: 0.15em; color: {{accent}}; margin-bottom: 2vmin; }
  h2 { font-size: 3.6vmin; font-weight: 700; line-height: 1.3; margin-bottom: 2vmin; }
  p { font-size: 2vmin; color: #aaa; line-height: 1.7; }
  ul { list-style: none; margin-top: 2.5vmin; }
  ul li { font-size: 1.9vmin; color: #ccc; padding: 0.8vmin 0; padding-left: 2.5vmin; position: relative; }
  ul li::before { content: ''; position: absolute; left: 0; top: 50%; width: 1vmin; height: 1vmin; background: {{secondary}}; border-radius: 50%; transform: translateY(-50%); }
</style>
</head>
<body>
<div class="slide">
  <div class="left">
    <div class="tag">Section Tag</div>
    <h2>Slide Heading</h2>
    <p>Description text goes here. Explain the key points of this slide.</p>
    <ul>
      <li>First point</li>
      <li>Second point</li>
      <li>Third point</li>
    </ul>
  </div>
  <div class="right">
    <!-- Add an image: <img src="./images/your-image.svg" alt="description"> -->
  </div>
</div>
</body>
</html>`
  },

  {
    name: "Card Grid",
    description: "Three-card flexbox layout for features or items",
    preview: "3 Cards",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slide - Cards</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: {{background}}; }
  .slide {
    width: 100vw; height: 100vh;
    overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif;
    color: {{foreground}}; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .tag { font-size: 1.6vmin; text-transform: uppercase; letter-spacing: 0.15em; color: {{accent}}; margin-bottom: 1.5vmin; }
  h2 { font-size: 3.4vmin; font-weight: 700; margin-bottom: 5vmin; }
  .cards { display: flex; gap: 4vmin; }
  .card {
    background: #16213e; border-radius: 1.5vmin; padding: 4vmin 3vmin;
    width: 22vmin; text-align: center; border: 1px solid #0f3460;
    transition: transform 0.3s, box-shadow 0.3s;
  }
  .card:hover { transform: translateY(-0.8vmin); box-shadow: 0 1vmin 3vmin rgba(0,0,0,0.4); }
  .card img { width: 8vmin; height: 8vmin; margin-bottom: 2vmin; }
  .card h3 { font-size: 2vmin; margin-bottom: 1vmin; }
  .card p { font-size: 1.5vmin; color: #aaa; line-height: 1.6; }
</style>
</head>
<body>
<div class="slide">
  <div class="tag">Section Tag</div>
  <h2>Card Heading</h2>
  <div class="cards">
    <div class="card">
      <h3>Card One</h3>
      <p>Description for the first card item.</p>
    </div>
    <div class="card">
      <h3>Card Two</h3>
      <p>Description for the second card item.</p>
    </div>
    <div class="card">
      <h3>Card Three</h3>
      <p>Description for the third card item.</p>
    </div>
  </div>
</div>
</body>
</html>`
  },

  {
    name: "Closing",
    description: "Centered call-to-action with action buttons",
    preview: "CTA + Buttons",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slide - Closing</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: {{background}}; }
  .slide {
    width: 100vw; height: 100vh;
    overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif;
    color: {{foreground}}; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
  }
  h2 { font-size: 4.5vmin; font-weight: 700; margin-bottom: 2vmin; }
  h2 span { color: {{accent}}; }
  p { font-size: 2.2vmin; color: #aaa; margin-bottom: 3.5vmin; }
  .links { display: flex; gap: 2.5vmin; justify-content: center; }
  .links a {
    display: inline-block; padding: 1.2vmin 3.5vmin; border-radius: 9999px;
    font-size: 1.8vmin; text-decoration: none; font-weight: 600;
    transition: transform 0.2s;
  }
  .links a:hover { transform: scale(1.05); }
  .links .primary { background: {{accent}}; color: {{foreground}}; }
  .links .secondary { border: 2px solid {{secondary}}; color: #ccc; }
  .footer { position: absolute; bottom: 4vmin; font-size: 1.4vmin; color: #555; }
</style>
</head>
<body>
<div class="slide">
  <h2>Thank <span>You</span></h2>
  <p>Your closing message or call to action goes here.</p>
  <div class="links">
    <a class="primary" href="#">Get Started</a>
    <a class="secondary" href="#">Learn More</a>
  </div>
  <div class="footer">Your Name &mdash; 2026</div>
</div>
</body>
</html>`
  }
];

/**
 * Resolve template placeholders against theme colors.
 * @param {string} html - Template HTML with {{...}} placeholders
 * @param {object} theme - Theme object with background, foreground, accent, secondary
 * @returns {string} Resolved HTML
 */
function resolveTemplate(html, theme) {
  const defaults = {
    background: "#0f0c29",
    foreground: "#ffffff",
    accent: "#e94560",
    secondary: "#533483",
  };
  const t = { ...defaults, ...theme };
  return html
    .replace(/\{\{background\}\}/g, t.background)
    .replace(/\{\{foreground\}\}/g, t.foreground)
    .replace(/\{\{accent\}\}/g, t.accent)
    .replace(/\{\{secondary\}\}/g, t.secondary);
}

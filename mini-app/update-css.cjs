const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'app', 'globals.css');
let cssContent = fs.readFileSync(cssPath, 'utf8');

// Replace border-radius: Xpx with border-radius: 4px
cssContent = cssContent.replace(/border-radius:\s*(8px|10px|12px|16px|20px|24px)/g, 'border-radius: 4px');

fs.writeFileSync(cssPath, cssContent);
console.log('Updated border-radius in globals.css');

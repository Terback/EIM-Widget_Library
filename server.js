// Minimal static-file server for local testing of the Appwrite-powered frontend.
// All backend logic lives in Appwrite — this just serves public/.
const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
    console.log(`Widget Library frontend → http://localhost:${PORT}`);
});

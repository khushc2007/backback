require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

app.use('/vapi', require('./routes/vapi'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'CallSync Backend' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CallSync backend running on port ${PORT}`));

const serve = require('../index');
const path = require('path');

serve(path.join(__dirname, "basicExample.php"), 8080);
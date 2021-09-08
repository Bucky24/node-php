const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const url = require('url');

const cacheDir = path.join(__dirname, "cache");
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir);
}

// https://stackoverflow.com/a/1349426/8346513
function makeid(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * 
 charactersLength));
   }
   return result;
}

function serve(phpFile, port) {
    if (!fs.existsSync(phpFile)) {
        throw new Error(`Main php file ${phpFile} could not be found`);
    }
    const server = http.createServer((req, res) => {
        let requestData = '';
        req.on('data', chunk => {
            requestData += chunk.toString('utf8');
        })
        req.on('end', () => {
            const { headers, method } = req;
            const urlObj = url.parse(req.url, true);
            let body = null;
            if (requestData !== '') {
                const type = headers['content-type'];
                if (type === 'text/json') {
                    body = JSON.parse(requestData);
                }
                // handle this at some point by checking the content type header
            }
            console.log(body);
            //console.log(requestData, urlObj);
            const cacheFile = makeid(12) + ".json";
            const cacheFilePath = path.join(cacheDir, cacheFile);
        
            const dataObject = {
                file: phpFile,
                query: urlObj.query,
                body,
            };
        
            fs.writeFileSync(cacheFilePath, JSON.stringify(dataObject));
        
            const command = `php ${path.join(__dirname, "php_runner.php")} ${cacheFilePath}`;
            //console.log(command);
            exec(command, (error, stdout, stderr) => {
                fs.unlinkSync(cacheFilePath);
                if (error) {
                    console.log("Got error from php runner:", error);
                    return;
                }
            
                //console.log(error, stdout, stderr);
                res.writeHead(200, {
                    'content-type': 'text/plain',
                });
                res.end(stdout);
            });
        });
    });
    
    server.listen(port, () => {
        console.log('PHP capable server started on port ' + port);
    });
}

module.exports = serve;
const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const urlParse = require('url');

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

const extensionToType = {
    ".html": "text/html",
    ".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
};

function serve(directory, port, staticDir = null, phpPath = null) {
    if (!fs.existsSync(directory)) {
        throw new Error(`Main directory file ${directory} could not be found`);
    }
    
    function processUrl(url) {
        let obj = {...urlParse.parse(url, true)};
		let resultOptions = [];
        
        // check for htaccess
        const htaccessFile = path.join(directory, ".htaccess");
        
        if (fs.existsSync(htaccessFile)) {
            const contents = fs.readFileSync(htaccessFile, 'utf8');
            const contentList = contents.split("\n");
            
            // pretty bog-standard parser to fetch out the module groups
            const modules = [];
            let module = null;
            let moduleLines = [];
            for (const line of contentList) {
                if (!module) {
                    const matches = line.match(/\<IfModule (.+)\>/);
                    if (matches) {
                        module = matches[1];
                    }
                } else {
                    const matches = line.match(/\<\/IfModule\>/);
                    if (matches) {
                        modules.push({
                            module,
                            lines: moduleLines,
                        });
                        module = null;
                        moduleLines = [];
                    } else {
                        if (line.trim() !== '') {
                            moduleLines.push(line.trim());
                        }
                    }
                }
            }
            
            modules.forEach((module) => {
                if (module.module === "mod_rewrite.c") {
                    // look for all the rewrite rules
                    const rules = module.lines.filter((line) => {
                        return line.startsWith("RewriteRule");
                    });
                    // split the rules up and get data for them
                    rules.forEach((rule) => {
                        const ruleList = rule.split(" ");
                        // the first entry will always be the actual RewriteRule text
                        ruleList.splice(0, 1);
                        // realistically we shouldn't have spaces in the next regex because spaces are not valid in a URL, so the next entries are going to be the checker regex and the actual rewrite template
                        const regex = ruleList.splice(0, 1)[0];
                        const template = ruleList.splice(0, 1)[0];
                        // if we have anything left, it's the options
                        const options = ruleList.length > 0 ? ruleList[0] : null;
						const optionList = [];
						if (options) {
							const optionsStripped = options.substr(1, options.length-2);
							const optionsListPre = optionsStripped.split(",");
							optionsListPre.forEach((option) => {
								optionList.push(option.trim());
							});
						}
                        
                        // cut off the first slash, since mod_rewrite doesn't expect it
                        const pathname = obj.pathname.substr(1);

                        // attempt to match the regex
                        const matches = pathname.match(regex);
                        if (matches) {
                            // cut off the first entry, since everything else is going to be a match group
                            matches.splice(0, 1);
                            // build array of params for template
                            const params = matches.reduce((obj, match, index) => {
                                return {
                                    ...obj,
                                    [`\$${index+1}`]: match,
                                };
                            }, {});
							
							resultOptions = [...optionList];
                            
                            let newPathName = template;
                            Object.keys(params).forEach((key) => {
                                newPathName = newPathName.replace(key, params[key]);
                            });
                            
                            // rebuild and reprocess the url
                            let newUrl = newPathName;
                            if (obj.search && obj.search !== "?") {
                                if (newUrl.includes("?")) {
                                    // merge the old search with the new search
                                    newUrl += "&" + obj.search.substr(1);
                                } else {
                                    newUrl += obj.search;
                                }
                            }
                            
                            obj = {
								...obj,
								...urlParse.parse(newUrl, true),
							};
                        }
                    });
                }
            });
        }
        
        return {
			obj,
			options: resultOptions,
		};
    }
    
    const server = http.createServer((req, res) => {
        const resHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'OPTIONS, POST, GET, PATCH, DELETE, PUT',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': 2592000, // 30 days
        };

        //console.log(req.method);

        if (req.method === 'OPTIONS') {
            res.writeHead(204, resHeaders);
            res.end();
            return;
        }

        let requestData = '';
        req.on('data', chunk => {
            requestData += chunk.toString('utf8');
        })
        req.on('end', () => {
            const { headers, method, rawHeaders } = req;
            //console.log(method);
            const { obj: urlObj, options } = processUrl(req.url);
			
			// process the raw headers into headers
			const processedRawHeaders = {};
			for (let i=0;i<rawHeaders.length;i+=2) {
				const key = rawHeaders[i];
				const value = rawHeaders[i+1];
				processedRawHeaders[key] = value;
			}
			
			const host = processedRawHeaders.Host;
			
			if (options.includes('R')) {
				const newUrl = host ? 'http://' + host + urlObj.path : urlObj.path;
				// we need to redirect to the new url and not continue
				res.writeHead(302, { 'location': newUrl });
				res.end();
				return;
			}

            if (urlObj.pathname === "/favicon.ico") {
                // 404 for now
                res.writeHead(404);
                res.end();
                return;
            }
            const cacheFiles = [];
            let body = null;
            const phpFiles = {};
            if (requestData !== '') {
                const type = headers['content-type'];
                if (type === 'application/json') {
                    body = JSON.parse(requestData);
                } else if (type === "application/x-www-form-urlencoded") {
                    const requestList = requestData.split("&");
                    body = {};
                    for (const request of requestList) {
                        const [key, value] = request.split("=");
						const decodedKey = decodeURIComponent(key);
						let useKey = decodedKey;
						if (decodedKey.includes("[")) {
							const keyList = [];
							let buffer = '';
							let blockOpen = false;
							const firstPos = decodedKey.indexOf("[");
							keyList.push(decodedKey.substr(0, firstPos));
							for (let i=firstPos;i<decodedKey.length;i++) {
								const char = decodedKey[i];
								if (char === '[' || char === ']') {
									if (buffer.length > 0 || blockOpen) {
										keyList.push(buffer);
										buffer = '';
									}
									if (char === '[') {
										blockOpen = true;
									} else if (char === ']') {
										blockOpen = false;
									}
								} else {
									buffer += char;
								}
							}
							
							const setInObj = (obj, keyList, value) => {	
								let key = keyList.shift();
								if (key === '') {
									// in this case we need to append to an array
									key = Object.keys(obj).length;
								}
								if (keyList.length === 0) {
									obj[key] = value;
									return;
								}
								
								if (!obj[key]) {
									const newObj = {};
									setInObj(newObj, keyList, value);
									obj[key] = newObj;
								} else {
									setInObj(obj[key], keyList, value);
								}
							}

							let useValue = value.replaceAll("+", " ");
							useValue = decodeURIComponent(useValue);
							setInObj(body, keyList, useValue);
						} else {
							let useValue = value.replaceAll("+", " ");
                        	body[useKey] = decodeURIComponent(useValue);
						}
                    }
                } else if (type.startsWith("multipart/form-data")) {
                    // get the boundary
                    const typeList = type.split(";");
                    const paramList = typeList.slice(1);
                    let boundary = null;
                    paramList.forEach((param) => {
                        let [key, value] = param.split("=");
                        key = key.trim();
                        if (key === "boundary") {
                            boundary = value.trim();
                        }
                    });

                    if (!boundary) {
                        throw new Error("Couldn't get boundary of multipart data!");
                    }

                    const boundaryDelim = "--" + boundary;
                    body = {};

                    // this signals the end of the form input, we need it to be normal here
                    requestData = requestData.replace(boundaryDelim + "--", boundaryDelim);

                    //console.log(boundaryDelim);
                    //console.log(requestData);

                    //console.log("processing");
                    const requestDataList = requestData.split(boundaryDelim);
                    for (const dataItem of requestDataList) {
                        //console.log("processing item");
                        const metaData = [];
                        const data = [];
                        let gotAllMetaData = false;
                        // we'll have some metadata with a carridge return line separating
                        const lines = dataItem.split("\n");
                        for (const line of lines) {
                            const useLine = line.trim();
                            //console.log([useLine]);
                            if (useLine === "\r" || useLine === "") {
                                if (metaData.length > 0) {
                                    // we're now processing data
                                    gotAllMetaData = true;
                                }
                            } else {
                                if (!gotAllMetaData) {
                                    metaData.push(useLine);
                                } else {
                                    data.push(useLine);
                                }
                            }
                        }
                        // if we didn't get any metadata it was just empty
                        if (metaData.length === 0) {
                            continue;
                        }
                        //console.log('got ', metaData, data);
                        //console.log(dataItem);

                        // now process the metadata to find out what we're dealing with
                        const metaDataObj = {};
                        for (const metaItem of metaData) {
                            const metaRow = metaItem.split(";");
                            for (let i=0;i<metaRow.length;i++) {
                                const delim = i === 0 ? ":" : "=";
                                let [key, value] = metaRow[i].split(delim);
                                key = key.trim();
                                value = value.trim();
                                if (value.startsWith("\"") && value.endsWith("\"")) {
                                    value = value.substr(1, value.length-2);
                                }
                                metaDataObj[key] = value;
                            }
                        }

                        //console.log(metaDataObj);

                        // now process
                        if (!metaDataObj['Content-Disposition']) {
                            throw new Error("No Content-Disposition metadata given for form data");
                        }
                        if (!metaDataObj['name']) {
                            throw new Error("No name metadata given for form data");
                        }

                        if (metaDataObj['Content-Disposition'] !== "form-data") {
                            throw new Error("Don't know how to handle Content-Disposition of \"" + metaDataObj['Content-Disposition'] + "\"");
                        }

                        const dataJoined = data.join("\n");

                        const acceptableTypes = [
                            "application/octet-stream",
                            "text/csv",
                        ];

                        if (metaDataObj['filename']) {
                            //console.log('handle as file');
                            if (!metaDataObj['Content-Type']) {
                                throw new Error("No Content-Type metadata given for form data, expected for file");
                            }
                            if (!metaDataObj['Content-Type']) {
                                throw new Error("No filename metadata given for form data, expected for file");
                            }
                            if (!acceptableTypes.includes(metaDataObj['Content-Type'])) {
                                throw new Error("Content-Type is \"" + metaDataObj['Content-Type'] + "\"-this system onloy knows how to handle " + acceptableTypes.join(", "));
                            }

                            const fileData = {
                                name: metaDataObj.filename,
                            }

                            // we need a temporary directory for the file data
                            
                            const cacheFile = makeid(12) + ".json";
                            const cacheFilePath = path.join(cacheDir, cacheFile);
                            cacheFiles.push(cacheFilePath);

                            fs.writeFileSync(cacheFilePath, dataJoined);
                            fileData.tmp_name = cacheFilePath;

                            phpFiles[metaDataObj['name']] = fileData;
                        } else {
                            body[metaDataObj['name']] = dataJoined;
                        }
                    }
                }
            }
            //console.log(body);
            //console.log(requestData, urlObj);
            const cacheFile = makeid(12) + ".json";
            const cacheFilePath = path.join(cacheDir, cacheFile);
            cacheFiles.push(cacheFilePath);
            
            let phpFile = urlObj.pathname;
            if (phpFile === "/") {
                // attempt to load index.php, then index.html if you can't find that. If we can't find either, just give up
                phpFile = "index.php";
                
                let fullFilePath = path.join(directory, phpFile);
                if (!fs.existsSync(fullFilePath)) {
                    phpFile = "index.html";
                }
            }
            
            let fullFilePath = path.join(directory, phpFile);
            const ext = path.extname(fullFilePath);

            if (ext !== ".php") {
                // attempt to serve the file from the static directory
                const staticFile = path.join(staticDir || directory, phpFile);
                fullFilePath = staticFile;
            }
            
            if (!fs.existsSync(fullFilePath)) {
                res.writeHead(404);
                res.end();
                return;
            }

            if (ext !== ".php") {
                // just serve the file normally
                // console.log('Serving static file', fullFilePath);
                const stat = fs.statSync(fullFilePath);
                res.writeHead(200, {
                    'Content-Type': extensionToType[ext] || "text/plain",
                    'Content-Length': stat.size,
                });

                const readStream = fs.createReadStream(fullFilePath);
                readStream.pipe(res);
                return;
            }
        
            const dataObject = {
                file: fullFilePath,
                query: urlObj.query,
                body,
                files: phpFiles,
                // need to verify what PHP normally does here
                request_uri: urlObj.path,
				headers: processedRawHeaders,
				baseDirectory: directory,
				host,
				sessionPath: cacheDir,
            };
        
            fs.writeFileSync(cacheFilePath, JSON.stringify(dataObject));
        
			let phpCommand = 'php-cgi';
			if (phpPath) {
				phpCommand = path.join(phpPath, 'php-cgi');
			}

            const errorLogFile = path.join(__dirname, "error_log");
            if (fs.existsSync(errorLogFile)) {
                fs.unlinkSync(errorLogFile);
            }
            const command = `${phpCommand} ${path.join(__dirname, "php_runner.php")}`;
            //console.log(command);
            exec(command, {
				env: {
					'QUERY_STRING': cacheFilePath,
				}, 
				maxBuffer: 5 * 1024 * 1024,
			}, (error, stdout, stderr) => {
                // unlink any other files we created in the cache
                for (const cacheFile of cacheFiles) {
                    fs.unlinkSync(cacheFile);
                }
                if (error) {
                    console.log("Got error from php runner:", error);
                    return;
                }

                if (stderr) {
                    console.log(stderr.trim());
                }

                if (fs.existsSync(errorLogFile)) {
                    const errorContents = fs.readFileSync(errorLogFile, "utf8");
                    console.log(errorContents);
                }
				
				//console.log("all stdout ", stdout);

				const [headers, ...rest] = stdout.split("\r\n\r\n");
				const result = rest.join('\r\n\r\n');
				const headerList = headers.split("\n");
				const resultHeaders = {};
				let overrideStatus = null;
				headerList.forEach((header) => {
					if (header.trim() === "") {
						return;
					}
					let [key, ...rest] = header.split(":");
					// handle the case when the header value has a colon in it
					let val = rest.join(':');
					val = val.trim();
					if (key === 'location') {
						key = 'Location';
					}
					if (key.toLowerCase() === 'status') {
						// the php-cgi adds a name to it
						const [num, ...rest] = val.split(" ");
						val = num;
						overrideStatus = num;
					}
					res.setHeader(key, val);
					if (!resultHeaders[key]) {
						resultHeaders[key] = [];
					}
					resultHeaders[key].push(val);
				});
				
				if (overrideStatus) {
					res.statusCode = overrideStatus;
				} else {
					res.statusCode = 200;
				}
				res.write(result);
                res.end();
            });
        });
    });
    
    server.listen(port, () => {
        console.log('PHP capable server started on port ' + port);
    });
}

module.exports = serve;
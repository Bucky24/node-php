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
        const originalObj = {...obj};
        
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
                        
                        const pathname = obj.pathname;

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
            original: originalObj,
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
        let binaryBuffer = Buffer.from([], "binary");
        req.on('data', chunk => {
            requestData += chunk.toString('utf8');
            binaryBuffer = Buffer.concat([binaryBuffer, chunk]);
        });
        req.on('end', () => {
            const { headers, method, rawHeaders } = req;
            //console.log(method);
            const { obj: urlObj, options, original: originalUrlObj } = processUrl(req.url);
			
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
            if (binaryBuffer.length > 0) {
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

                    //console.log(boundaryDelim);

                    const state = {
                        state: 'none',
                        buffer: '',
                        headerData: {},
                    };
                    const items = [];
                    // loop over all the binary data
                    for (const num of binaryBuffer) {
                        const char = String.fromCharCode(num);
                        //console.log(state.state, num, char);
                        if (state.state === "none") {
                            const newBuffer = state.buffer + char;

                            if (newBuffer === boundaryDelim) {
                                state.state = "foundBoundary";
                                state.buffer = "";
                                continue;
                            } else {
                                state.buffer = newBuffer;
                                continue;
                            }
                        } else if (state.state === "foundBoundary") {
                            if (num === 13) {
                                state.state = "foundCR";
                                continue;
                            } else if (char === "-") {
                                if (!state.dashCount) {
                                    state.dashCount = 0;
                                }
                                state.dashCount ++;

                                if (state.dashCount === 2) {
                                    console.log("end of data!");
                                    // no reason to go further, this is the end of the data
                                    break;
                                }
                                continue;
                            }
                        } else if (state.state === "foundCR") {
                            if (num === 10) {
                                state.state = "getHeader";
                                state.buffer = "";
                                continue;
                            }
                        } else if (state.state === "getHeader") {
                            const newBuffer = state.buffer + char;

                            if (char === ":") {
                                state.header = newBuffer;
                                state.state = "gettingParams";
                                state.buffer = "";
                                state.params = [];
                            } else {
                                state.buffer = newBuffer;
                            }
                            continue;
                        } else if (state.state === "gettingParams") {
                            if (char === ";") {
                                //console.log("got param", state.buffer);
                                state.params.push(state.buffer);
                                state.buffer = "";
                                continue;
                            } else if (num === 13) {
                                //console.log("got param", state.buffer);
                                state.params.push(state.buffer);
                                state.headerData[state.header] = state.params;
                                delete state.params;
                                state.buffer = "";
                                state.state = "haveParams";
                                state.lineCount = 0;
                                state.foundCR = true;
                                continue;
                            } else {
                                const newBuffer = state.buffer + char;
                                state.buffer = newBuffer;
                                continue;
                            }
                        } else if (state.state === "haveParams") {
                            if (num === 10 && state.foundCR) {
                                state.lineCount ++;
                                state.foundCR = false;
                                if (state.lineCount === 2) {
                                    state.state = "expectingData";
                                    state.binaryBuffer = [];
                                }
                                continue;
                            } else if (num === 13 && !state.foundCR) {
                                state.foundCR = true;
                                continue;
                            } else if (char == "C" && state.lineCount === 1) {
                                state.state = "getHeader";
                                state.buffer = "C";
                                state.lineCount = 0;
                                continue;
                            }
                        } else if (state.state === "expectingData") {
                            const newBuffer = state.buffer + char;
                            state.buffer = newBuffer;
                            state.binaryBuffer.push(num);
                            if (newBuffer.endsWith(boundaryDelim)) {
                                const stopIndex = state.buffer.length - (2 + boundaryDelim.length);
                                const dataWithoutBuffer = state.buffer.substring(0, state.buffer.length - (2 + boundaryDelim.length));
                                const binaryWithoutBuffer = state.binaryBuffer.splice(0, stopIndex);
                                //console.log('pushing item\n');
                                const item = {
                                    headers: state.headerData,
                                    data: dataWithoutBuffer,
                                    binaryData: binaryWithoutBuffer, 
                                };
                                state.buffer = "";
                                state.state = "foundBoundary";
                                delete state.binaryBuffer;
                                state.headerData = [];
                                items.push(item);
                            }
                            continue;
                        } else if (state.state === "wtf") {
                            continue;
                        }

                        throw new Error("Unxpected state while processing: " + JSON.stringify(state) + " got " + num);
                    }

                    const processedItems = [];
                    for (const item of items) {
                        const resultItem = {
                            data: item.data,
                            binaryData: item.binaryData,
                        };
                        for (const header in item.headers) {
                            const data = item.headers[header];

                            //console.log(header, data);

                            if (header === "Content-Disposition:") {
                                if (data[0] !== " form-data") {
                                    throw new Error("Expected first param of Content-Disposition to be 'form-data'");
                                }

                                for (let i=1;i<data.length;i++) {
                                    const dataItem = data[i].trim();
                                    //console.log(dataItem);
                                    const [field, ...valueList] = dataItem.split("=");
                                    let value = valueList.join("=");
                                    // trim off the quotes
                                    value = value.substring(1, value.length-1);
                                    //console.log(field, value);
                                    resultItem[field] = value;
                                }
                            } else {
                                // trim the colon from the header
                                resultItem[header.substring(0, header.length-1)] = data[0].trim();
                            }
                        }

                        processedItems.push(resultItem);
                    }

                    for (const item of processedItems) {
                        if (item.filename) {
                            if (!item['Content-Type']) {
                                throw new Error("No Content-Type metadata given for form data, expected for file");
                            }

                            const fileData = {
                                name: item.filename,
                            }

                            const ext = path.extname(item.filename);
                            
                            const cacheFile = makeid(12) + ext;
                            const buffer = Buffer.from(item.binaryData, "binary");
                            const cacheFilePath = path.join(cacheDir, cacheFile);
                            cacheFiles.push(cacheFilePath);
                            
                            fs.writeFileSync(cacheFilePath, buffer);
                            fileData.tmp_name = cacheFilePath;

                            phpFiles[item['name']] = fileData;
                        } else {
                            body[item.name] = item.data;
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
            let fullFilePath = path.join(directory, phpFile);

            if (fs.existsSync(fullFilePath)) {
                // check if we're loading a directory, in which case try to get an index file
                // if the file doesn't exist we will handle it below
                const stats = fs.lstatSync(fullFilePath);
                if (stats.isDirectory()) {
                    // attempt to load index.php, then index.html if you can't find that. If we can't find either, just give up
                    phpFile = "index.php";
                    
                    let newFilePath = path.join(fullFilePath, phpFile);
                    if (!fs.existsSync(fullFilePath)) {
                        phpFile = "index.html";
                    }
                    newFilePath = path.join(fullFilePath, phpFile);
                    fullFilePath = newFilePath;
                }
            }
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
                request_uri: originalUrlObj.path,
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
            const command = `${phpCommand} \"${path.join(__dirname, "php_runner.php")}\"`;
            //console.log(command);
            exec(command, {
				env: {
					'QUERY_STRING': cacheFilePath,
				}, 
				maxBuffer: 5 * 1024 * 1024,
			}, (error, stdout, stderr) => {
                if (fs.existsSync(errorLogFile)) {
                    const errorContents = fs.readFileSync(errorLogFile, "utf8");
                    console.log(errorContents);
                } else {
                    if (error) {
                        console.log("Got error from php runner and no error log was generated:", error);
                        console.log("To replay, run\nQUERY_STRING=\"" + cacheFilePath + "\" " + command);
                        return;
                    }
                }

                // unlink any cache files
                for (const cacheFile of cacheFiles) {
                    fs.unlinkSync(cacheFile);
                }

                if (stderr) {
                    console.log(stderr.trim());
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
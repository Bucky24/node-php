<?php
    $file = $argv[1];
    
    $data = file_get_contents($file);
    $data = json_decode($data, true);
    
    //print_r($data);
    
    if (array_key_exists("query", $data)) {
        foreach ($data['query'] as $key=>$value) {
            $_GET[$key] = $value;
            $_REQUEST[$key] = $value;
        }
    }
    
    if (array_key_exists("body", $data) && $data["body"] !== null) {
        foreach ($data['body'] as $key=>$value) {
            $_POST[$key] = $value;
            $_REQUEST[$key] = $value;
        }
    }

    if (array_key_exists("request_uri", $data) && $data['request_uri'] !== null) {
        $_SERVER['REQUEST_URI'] = $data['request_uri'];
    }

    if (array_key_exists("files", $data) && $data['files'] !== null) {
        $_FILES = $data['files'];
    }
	
	if (!function_exists("getallheaders")) {
		function getallheaders() {
			global $data;
			return $data['headers'];
		}
	}
    
    include_once($data['file']);
?>
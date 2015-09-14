var https = require('https');
var querystring = require('querystring');

var yaasHost = 'api.yaas.io';
var pathToken = '/hybris/oauth2/b1/token';
var pathPubSubBase = '/hybris/pubsub/b2/topics';
var pathOrderBase = '/hybris/order/b1';

var debug = false;
var verbose = false;
var clientId, clientSecret, scope;
var accessToken;

exports.init = function () {
	return new Promise(function (resolve, reject) {
		if (debug) {
			console.log("Client ID:", clientId);
			console.log("Client secret:", clientSecret);
			console.log("Scope:", scope);
		}
	
		if (!clientId || !clientSecret || !scope) {
			reject("Client ID, Client Secret and Scope have to be set!");
		} else {
			getToken().then(function () {
				resolve();
			}).catch(function () {
				reject();
			});
		}
	});
};

exports.setClientId = function (value) {
	clientId = value;
}

exports.setClientSecret = function (value) {
	clientSecret = value;
}

exports.setScope = function (value) {
	scope = value;
}

exports.setDebug = function (state) {
	debug = state;
}

exports.setVerbose = function (state) {
	verbose = state;
}

function getToken() {
	return new Promise(function (resolve, reject) {
		sendPostRequest(
			pathToken,
			'application/x-www-form-urlencoded',
			querystring.stringify({
				'grant_type' : 'client_credentials',
				'scope' : scope,
				'client_id' : clientId,
				'client_secret' : clientSecret
			})
		).then(function (response) {
			if (response.statusCode == 200) {
				accessToken = response.body.access_token;
				if (debug) {
					console.log('Received access token: ' + accessToken);
					console.log("Granted scopes: " + response.body.scope);
				}
				resolve();
			} else {
				console.error("Could not obtain token!");
				console.error(JSON.stringify(response.body));
				reject();
			}
		});
	});
}

function sendRequest(method, path, mime, data) {
	return new Promise(function (resolve, reject) {
		var headers = {
			'Content-Type': mime
		};
	
		if (accessToken != null) {
			headers['Authorization'] = 'Bearer ' + accessToken;
		}
	
		var options = {
			hostname: yaasHost,
			port: 443,
			path: path,
			method: method,
			headers: headers
		};
	
		var req = https.request(options, function (res) {
			res.setEncoding('utf8');
			var data = "";

			res.on('data', function (chunk) {
				data += chunk;
			});

			res.on('end', function() {
				if (debug) {
					console.log('Status code: ' + res.statusCode);
					console.log('Headers: ' + JSON.stringify(res.headers));
					console.log('Body: ' + data);
				}
		
				if (res.statusCode >= 400) {
					reject(res.statusCode);
				} else {
					var responseBody;
					var responseMime;
					if (res.headers['content-type']) {
						responseMime = res.headers['content-type'].split(';')[0];
					}
					switch (responseMime) {
					case 'text/plain':
						responseBody = data;
						break;
					case 'application/json':
						try {
							responseBody = JSON.parse(data);
						} catch (e) {
							return reject('Could not read server response: ' + e.message);
						}
						break;
					default:
						responseBody = data;
					}
					resolve({statusCode: res.statusCode, body: responseBody});
				}
			});
		});
	
		req.on('error', function(e) {
			reject('problem with request: ' + e.message);
		});

		if (data && (method == 'POST' || method == 'PUT')) {
			if (debug) {
				console.log('Sending data: ' + data);
			}
			req.write(data);
		}
		req.end();
	});
}

function sendPostRequest(path, mime, postData) {
	return sendRequest('POST', path, mime, postData);
}

exports.checkForOrderStatusChange = function (callback) {
	if (verbose) {console.log("Checking for order status changes...");}
	sendPostRequest(
		pathPubSubBase + '/hybris.order/order-status-changed/read',
		'application/json',
		JSON.stringify({
			"numEvents": 1,
			"autoCommit": false
		})
	).then(function (response) {
		if (response.statusCode == 204) {
			if (verbose) {
				console.log("No events available");
			}
			callback();
		} else if (response.statusCode == 200) {
			var events = response.body.events;
			events.forEach(function(event) {
				if (debug) {
					console.log("Processing event: %s", JSON.stringify(event));
				}
				
				if (event.eventType != "order-status-changed") {
					console.log("Wrong event type: %s!", event.eventType);
					return;
				}
				
				var payload;
				try {
					payload = JSON.parse(event.payload);
				} catch (e) {
					console.log("Could not parse payload");
					callback(new Error("Could not parse payload: " + e.message));
					return;
				}
				callback(null, payload, response.body.token);
			});
		} else {
			if (debug) {
				console.log("Problem: " + JSON.stringify(response.body));
			}
			callback(new Error("Problem with request: " + JSON.stringify(response.body)));
		}
	}).catch(function (reason) {
		callback(new Error(reason));
	});
}

exports.commitEvents = function (token, callback) {
	if (verbose) {console.log("Committing events...");}
	
	sendPostRequest(
		pathPubSubBase + '/hybris.order/order-status-changed/commit',
		'application/json',
		JSON.stringify({
			"token": token
		})
	).then(function (response) {
		if (response.statusCode == 200) {
			if (verbose) {
				console.log("Event(s) committed");
			}
			callback();
		} else {
			if (debug) {
				console.log("Problem: " + JSON.stringify(response.body));
			}
			callback(new Error("Problem: " + JSON.stringify(response.body)));
		}
	}).catch(function (reason) {
		callback(new Error(reason));
	});
}
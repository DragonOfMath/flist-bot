/**
	Developed by DragonOfMath for The Fluffy Inn
*/

const Discordie   = require('discordie');
const request     = require('request');
const fs          = require('fs');

const auth        = require('./auth.json');
const kinkRoleMap = require('./kinks.json') || {};
const roleAliases = require('./aliases.json') || {};

const USER_AGENT  = 'FListBot/request';
const HTML_ENTITY = /&#?(.+);/g;
const ENTITY_MAP  = {
	'lt': '<',
	'gt': '>',
	'amp': '&',
	'quot': '"',
	'apos': '\'',
	'cent': '¢',
	'pound': '£',
	'yen': '¥',
	'euro': '€',
	'copy': '©',
	'reg': '®'
};

const FLIST_ACCT  = /^https:\/\/www.f-list.net\/c\/(.+)/;
const FLIST_COLOR = 0x1b446f;
const FLIST_CHOICES = ['fave','yes','maybe','no'];

const PREFIX      = '.flist';
const HELP = `FListBot can retrieve your F-List page and assign you roles based on the things you like.

**__Usage__**:

\`${PREFIX} [f-list url | character name], [choices]\` - lookup your character's kinks and get roles relevant to them.
	Additionally, choices let you decide which kinks are relevant: **fave**, **yes**, **maybe**, and **no**.
	
\`${PREFIX} ilike/ilove/addme/roleme [roles | kinks]\` - assigns you the roles that are linked to the following kinks/aliases.

\`${PREFIX} idislike/ihate/removeme/unroleme [roles | kinks]\` - removes you from the roles that are linked to the following kinks/aliases.

\`${PREFIX} kinks\` - get a list of kink groups.

\`${PREFIX} kinks [kinkGroupName]\` - get a list of kinks that are in a group.

\`${PREFIX} kink [kinkName]\` - get the description of the kink, if it exists.

**__Admin-Only__**:

\`${PREFIX} alias add/set [role] [alias1, alias2, ...]\` - adds aliases to a role.

\`${PREFIX} alias remove/clear [role] [alias1, alias2, ...]\` - removes aliases from a role.

\`${PREFIX} alias view/list [role]\` - view aliases for the given role, or all applicable roles if one isn't specified.

\`${PREFIX} assign/add/link/map [role] [kink1, kink2, ...]\` - map the following kink names, delimited by commas, to the role.

\`${PREFIX} unassign/remove/unlink/unmap [role] [kink1, kink2, ...]\` - delete the following kink names, delimited by commas, from the role.

\`${PREFIX} assigned/mapped/linked [role]\` - view kinks assigned to a role, or all applicable roles if one isn't specified.

\`${PREFIX} quit/exit/stop\` - stop running the bot.
`;


function fetch(url, options = {}) {
	options.url     = 'url'  in options ? options.url  : url;
	options.json    = 'json' in options ? options.json : /\.json\b/i.test(options.url);
	options.headers = {'User-Agent': USER_AGENT};
	return new Promise((resolve,reject) => {
		request(options, function (error, response, body) {
			if (error) {
				reject(error);
			} else if (response.statusCode !== 200) {
				reject('Status Code: '+response.statusCode);
			} else try {
				resolve(body);
			} catch (e) {
				reject(e.message);
			}
		});
	});
}
function quote(x) {
	return `"${x}"`;
}
function strcmp(a,b) {
	return String(a).toLowerCase() == String(b).toLowerCase();
}
function unescapeHTMLEntities(text) {
	return text.replace(HTML_ENTITY, function (html, code) {
		return ENTITY_MAP[code] || String.fromCharCode(code) || code;
	});
}

function parseCSV(values) {
	if (values instanceof Array) {
		values = values.join(' ');
	}
	return values.split(/,\s*/);
}
function parseRole(role) {
	if (/\d+/.test(role)) {
		role = role.match(/\d+/);
	}
	for (var r in roleAliases) {
		if (roleAliases[r].some(a => strcmp(a,role))) {
			return r;
		}
	}
	return role;
}

function save(file, object) {
	console.log('Saving ' + file + '.json');
	return fs.writeFileSync('./' + file + '.json', JSON.stringify(object, null, '\t'));
}

class Kink {
	constructor(kink) {
		this.id          = kink.kink_id;
		this.name        = unescapeHTMLEntities(kink.name);
		this.description = kink.description;
	}
	embed() {
		return {
			title: 'F-List - Kink: ' + this.name,
			description: this.description,
			color: FLIST_COLOR
		};
	}
	toString() {
		return `${this.id}: **${this.name}**`;
	}
}

class KinkGroup {
	constructor(id, data) {
		this.id    = id;
		this.name  = unescapeHTMLEntities(data.group);
		this.kinks = data.items.map(k => new Kink(k));
	}
	embed() {
		var e = {
			title: 'F-List - Kink Group: ' + this.name,
			description: '',
			color: FLIST_COLOR
		};
		for (var kink of this.kinks) {
			e.description += kink.toString();
			
			e.description += '\n';
		}
		return e;
	}
	toString() {
		return `${this.id}: **${this.name}** (${this.kinks.length})`;
	}
}

class FList {
	constructor(account, password) {
		this.account     = account;
		this.password    = password;
		this.ticket      = '';
		this.kinkGroups  = {};
		this.globalKinks = {};
		
		console.log('Retrieving API ticket...');
		this.renewTicket().then(() => {
			setInterval(() => this.renewTicket(), 1800000); // every 30 minutes
			return this.setupGlobalKinkList();
		});
	}
	renewTicket() {
		var form = {
			account: this.account,
			password: this.password,
			// do not require information about these
			no_characters: true,
			no_bookmarks: true,
			no_friends: true
		};
		return fetch('https://www.f-list.net/json/getApiTicket.php', {
			method: 'POST',
			json: true,
			form: form
		}).then(body => {
			this.ticket = body.ticket;
			console.log('F-List API ticket renewed:',this.ticket);
			return this.ticket;
		}).catch(err => {
			console.error('Error while renewing ticket:',err);
		});
	}
	setupGlobalKinkList() {
		console.log('Retrieving global kink list...');
		return fetch('https://www.f-list.net/json/api/kink-list.php', {
			json: true
		}).then(body => {
			for (var kg in body.kinks) {
				this.kinkGroups[kg] = new KinkGroup(kg, body.kinks[kg]);
				this.kinkGroups[kg].kinks.forEach(kink => {
					this.globalKinks[kink.id] = kink;
				});
			}
			console.log('Global kink table established.');
		});
	}
	getCharacter(character) {
		var form = {
			account: this.account,
			ticket: this.ticket
		};
		if (typeof character === 'string') {
			form.name = character;
		} else if (typeof character === 'number') {
			form.id = character;
		} else {
			throw 'Invalid character name or ID: ' + character;
		}
		return fetch('https://www.f-list.net/json/api/character-data.php', {
			json: true,
			form: form
		});
	}
	mapKinks(kinks) {
		var mappedKinks = {};
		for (var id in kinks) {
			mappedKinks[id] = this.globalKinks[id];
		}
		return mappedKinks;
	}
	getKinkGroup(kinkGroup) {
		for (var kg in this.kinkGroups) {
			var group = this.kinkGroups[kg];
			if (strcmp(group.name, kinkGroup) || group.id == kinkGroup) {
				return group;
			}
		}
		return null;
	}
	findKinkGroup(kinkName) {
		for (var kg in this.kinkGroups) {
			var group = this.kinkGroups[kg];
			var kink = group.kinks.find(kink => strcmp(kink.name, kinkName) || kink.id == kinkName);
			if (kink) return group;
		}
		return null;
	}
	getKink(kinkName) {
		for (var k in this.globalKinks) {
			var kink = this.globalKinks[k];
			if (strcmp(kink.name, kinkName) || kink.id == kinkName) {
				return kink;
			}
		}
		return null;
	}
	search(query) {
		var matchedKinks = [];
		for (var k in this.globalKinks) {
			var kink = this.globalKinks[k];
			var name = kink.name.toLowerCase();
			if (query.some(q => name.includes(q.toLowerCase()))) {
				matchedKinks.push(kink);
			}
		}
		return matchedKinks;
	}
	embed() {
		var e = {
			title: 'F-List - Kink Groups',
			description: '',
			color: FLIST_COLOR
		};
		for (var kg in this.kinkGroups) {
			var group = this.kinkGroups[kg];
			e.description += group.toString() + '\n';
		}
		return e;
	}
}

const flist = new FList(auth.account, auth.password);
const client = new Discordie({
	autoReconnect: true
});

client.connect({
	token: auth.token,
	autorun: true
});
client.Dispatcher.on('GATEWAY_READY', () => {
	client.User.setStatus({
		name: PREFIX + ' help',
		type: 0
	});
	console.log('FListBot connected.');
});
client.Dispatcher.on('MESSAGE_CREATE', (response) => {
	var channel = response.message.channel;
	var guild   = channel.guild;
	var user    = response.message.author;
	var member  = guild ? user.memberOf(guild) : null;
	var message = response.message.content;
	
	if (user.id === client.User.id || !message.startsWith(PREFIX)) return;
	
	function checkAuth() {
		if (!auth.admins.includes(user.id)) {
			channel.sendMessage(':warning: You are not authorized to use this command.');
			return true;
		}
		return false;
	}
	function error(e) {
		console.error(e);
		channel.sendMessage('Oopsie woopsie! UwU we made a fucky wucky! A wittle fucko boingo!\n```\n' + e + '\n```');
	}
	function softError(e) {
		console.error(e);
		channel.sendMessage('Oops! Something went wrong...');
	}
	function getKinkRole(kink) {
		kink = flist.getKink(kink);
		if (kink) for (var roleID in kinkRoleMap) {
			if (kinkRoleMap[roleID].find(k => k == kink.id)) {
				return roleID;
			}
		}
		return 0;
	}
	function getRoleName(role) {
		role = guild.roles.find(r => r.id == role);
		return role ? role.name : '';
	}
	
	console.log('Command:',message);
	var args = message.substring(PREFIX.length+1).split(' ');
	switch (args[0]) {
		case 'help':
		case 'halp':
		case 'ayuda':
		case '?':
			channel.sendMessage(HELP);
			break;
			
		case 'ilike':
		case 'ilove':
		case 'addme':
		case 'roleme':
			var roles = parseCSV(args.slice(1)).map(id => {
				var role = parseRole(id);
				if (Number(role)) return role;
				else return getKinkRole(id);
			});
			roles.filter(Boolean).forEach(role => {
				member.assignRole(role);
			});
			channel.sendMessage('I have assigned you some roles based on your interests.');
			break;
			
		case 'idislike':
		case 'ihate':
		case 'removeme':
		case 'unroleme':
			var roles = parseCSV(args.slice(1)).map(id => {
				var role = parseRole(id);
				if (Number(role)) return role;
				else return getKinkRole(id);
			});
			roles.filter(Boolean).forEach(role => {
				member.unassignRole(role);
			});
			channel.sendMessage('I have removed some of your roles that you didn\'t like.');
			break;
			
		case 'kink':
			var kinkName = args.slice(1).join(' ');
			var kink = flist.getKink(kinkName);
			if (!kink) return error('Unknown kink: ' + quote(kinkName));
			channel.sendMessage('', false, kink.embed());
			break;
			
		case 'kinks':
			var specificKinkGroup = args.slice(1).join(' ');
			if (specificKinkGroup) {
				var group = flist.getKinkGroup(specificKinkGroup);
				if (!group) return error('Unknown kink group: ' + quote(specificKinkGroup));
				channel.sendMessage('', false, group.embed());
			} else {
				channel.sendMessage('', false, flist.embed());
			}
			break;
			
		case 'search':
		case 'find':
		case 'lookup':
			var kinkQuery = parseCSV(args.slice(1));
			var results = flist.search(kinkQuery);
			if (results.length) {
				var e = {
					title: 'F-List - Kinks matching ' + kinkQuery.map(quote).join(', '),
					description: '',
					color: FLIST_COLOR
				};
				for (var kink of results) {
					e.description += kink.toString() + '\n';
				}
				channel.sendMessage('', false, e);
			} else {
				channel.sendMessage('No kinks matched your query.');
			}
			break;
			
		case 'alias':
			if (checkAuth()) break;
		
			var [role, ...aliases] = args.slice(2);
			role = parseRole(role);
			aliases = parseCSV(aliases);
			switch (args[1]) {
				case 'add':
				case 'set':
					if (!role) {
						return error('Invalid role ID: ' + quote(role));
					}
					roleAliases[role] = roleAliases[role] || [];
					for (var a of aliases) {
						if (!roleAliases[role].find(ra => strcmp(ra,a))) {
							roleAliases[role].push(a);
						}
					}
					try {
						save('aliases', roleAliases);
						channel.sendMessage('Aliases updated for role ' + quote(getRoleName(role)));
					} catch (e) {
						softError(e);
					}
					break;
				case 'remove':
				case 'clear':
					if (!role) {
						return error('Invalid role ID: ' + quote(role));
					}
					roleAliases[role] = roleAliases[role] || [];
					for (var a of aliases) {
						var idx = roleAliases[role].findIndex(ra => strcmp(ra,a));
						if (idx > -1) {
							roleAliases[role].splice(idx, 1);
						}
					}
					try {
						save('aliases', roleAliases);
						channel.sendMessage('Aliases updated for role ' + quote(getRoleName(role)));
					} catch (e) {
						softError(e);
					}
					break;
				case 'view':
				case 'list':
					if (role) {
						var name = getRoleName(role);
						if (role in roleAliases) {
							channel.sendMessage('', false, {
								title: 'F-List - Aliases for ' + quote(name),
								description: roleAliases[role].join('\n'),
								color: FLIST_COLOR
							});
						} else {
							channel.sendMessage('The role ' + quote(name) + ' does not have any aliases set.');
						}
					} else {
						channel.sendMessage('', false, {
							title: 'F-List - All Role Aliases',
							description: Object.keys(roleAliases).map(id => {
								var name = getRoleName(id);
								return name + ' => ' + roleAliases[id].join(', ');
							}).join('\n'),
							color: FLIST_COLOR
						});
					}
					break;
			}
			break;
			
		case 'assign':
		case 'add':
		case 'link':
		case 'map':
			if (checkAuth()) break;
			var [role, ...kinks] = args.slice(1);
			role  = parseRole(role);
			kinks = parseCSV(kinks);
			if (!role) {
				return error('Invalid role ID: ' + quote(role));
			}
			kinkRoleMap[role] = kinkRoleMap[role] || [];
			for (var kinkID of kinks) {
				var kink = flist.getKink(kinkID);
				if (!kink) return error('Invalid kink: ' + quote(kinkID));
				
				if (!kinkRoleMap[role].includes(kink.id)) {
					kinkRoleMap[role].push(kink.id);
				} else {
					console.log('Kink already assigned:',kink.id,'/',kink.name);
				}
			}
			try {
				save('kinks', kinkRoleMap);
				channel.sendMessage('Kink map successfully updated.');
			} catch (e) {
				softError(e);
			}
			break;
			
		case 'unassign':
		case 'remove':
		case 'unlink':
		case 'unmap':
			if (checkAuth()) break;
			var [role, ...kinks] = args.slice(1);
			role  = parseRole(role);
			kinks = parseCSV(kinks);
			if (!role) {
				return error('Invalid role ID: ' + quote(role));
			}
			kinkRoleMap[role] = kinkRoleMap[role] || [];
			for (var kinkID of kinks) {
				var kink = flist.getKink(kinkID);
				if (!kink) return error('Invalid kink: '+ quote(kinkID));
				
				var idx = kinkRoleMap[role].findIndex(id => id == kink.name || id == kink.id);
				if (idx > -1) {
					kinkRoleMap[role].splice(idx, 1);
				} else {
					console.log('Kink not found:',kink.id,'/',kink.name);
				}
			}
			try {
				save('kinks', kinkRoleMap);
				channel.sendMessage('Kink map successfully updated.');
			} catch (e) {
				softError(e);
			}
			break;
			
		case 'assigned':
		case 'linked':
		case 'mapped':
			if (checkAuth()) break;
			var role = parseRole(args.slice(1).join(' '));
			var name = getRoleName(role);
			if (role || name) {
				if (name) {
					if (role in kinkRoleMap) {
						var e = {
							title: 'F-List - Kinks assigned to ' + quote(name),
							description: kinkRoleMap[role].map(kink => {
								return flist.getKink(kink).toString();
							}).join('\n'),
							color: FLIST_COLOR
						};
						channel.sendMessage('', false, e);
					} else {
						channel.sendMessage('There are no kinks assigned to ' + quote(name));
					}
				} else {
					error('Invalid role ID: ' + quote(role));
				}
			} else {
				var e = {
					title: 'F-List - Assigned Kinks',
					description: '',
					fields: [],
					color: FLIST_COLOR
				};
				for (role in kinkRoleMap) {
					e.fields.push({
						name: getRoleName(role),
						value: kinkRoleMap[role].map(kink => {
							return flist.getKink(kink).toString();
						}).join('\n'),
						inline: true
					});
				}
				channel.sendMessage('', false, e);
			}
			break;
			
		case 'quit':
		case 'exit':
		case 'stop':
			if (checkAuth()) return;
			client.disconnect();
			process.exit(0);
			break;
			
		default:
			var [name, ...choices] = args.slice(1);
			if (FLIST_ACCT.test(name)) name = name.match(FLIST_ACCT)[1];
			if (choices.length == 0) choices = ['fave','yes'];
			
			flist.getCharacter(name)
			.then(characterData => {
				if (!characterData) throw 'Character data not found.';
				
				var characterKinks = characterData.kinks;
				//var mappedKinks = flist.mapKinks(characterKinks);
				var recognizedKinks = [];
				for (var roleID in kinkRoleMap) {
					if (kinkRoleMap[roleID].some(kinkName => {
						var kink = flist.getKink(kinkName);
						return (kink && (kink.id in characterKinks) && (choices.includes(characterKinks[kink.id])));
					})) {
						recognizedKinks.push(roleID);
						member.assignRole(roleID);
					}
				}
				if (recognizedKinks.length) {
					channel.sendMessage('I assigned you some roles based on your F-List likes.');
				} else {
					channel.sendMessage('Hmm, I don\'t recognize any kinks you have.');
				}
			})
			.catch(error);
	}
});


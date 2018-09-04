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

const PREFIX = 'flist.';

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
				if (body && body.error) throw body.error;
				resolve(body);
			} catch (e) {
				reject(e);
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
			title: this.name,
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
			title: 'Group: ' + this.name,
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
		if (FLIST_ACCT.test(character)) {
			character = character.match(FLIST_ACCT)[1];
		}
		
		var form = {
			account: this.account,
			ticket:  this.ticket
		};
		if (typeof character === 'string') {
			form.name = character;
		} else if (typeof character === 'number') {
			form.id = character;
		} else {
			throw 'Invalid character name or ID: ' + character;
		}
		return fetch('https://www.f-list.net/json/api/character-data.php', {
			method: 'POST',
			json: true,
			form: form
		});
	}
	getAssignableRoles(charData, choice = 1) {
		if (!charData) throw 'Character not found.';
		var charKinks = charData.kinks;
		if (!charKinks) throw 'Character kinks missing.';
		var kinkMap = {};
		for (var roleID in kinkRoleMap) {
			var kinks = kinkRoleMap[roleID];
			var kinksMatched = [];
			if (kinks.some(kinkID => {
				return (kinkID in charKinks)
				&& (FLIST_CHOICES.indexOf(charKinks[kinkID]) <= choice)
				&& (kinksMatched.push(kinkID));
			})) {
				kinkMap[roleID] = kinksMatched;
			}
		}
		return kinkMap;
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
	getKinkRole(kink) {
		kink = this.getKink(kink);
		if (kink) for (var roleID in kinkRoleMap) {
			if (kinkRoleMap[roleID].find(k => k == kink.id)) {
				return roleID;
			}
		}
		return 0;
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
			title: 'Kink Groups',
			description: ''
		};
		for (var kg in this.kinkGroups) {
			var group = this.kinkGroups[kg];
			e.description += group.toString() + '\n';
		}
		return e;
	}
}

const flist = new FList(auth.account, auth.password);

class Context {
	constructor(response, client) {
		this.context = this;
		this.client  = client;
		this.message = response.message;
		this.content = this.message.content;
		this.channel = this.message.channel;
		this.guild   = this.channel.guild;
		this.user    = this.message.author;
		this.member  = this.guild ? this.user.memberOf(this.guild) : null;
		
		this.command = this.content.startsWith(PREFIX) ? this.content.substring(PREFIX.length+0) : '';
		if (this.command) {
			var [cmd, ...args] = this.command.split(' ');
			this.cmd  = cmd;
			this.args = args;
		}
	}
	handleError(err) {
		if (err) {
			console.error(err);
			return this.channel.sendMessage(':warning: ' + err);
		}
	}
	softError(err) {
		if (err) {
			console.error(err);
			return this.channel.sendMessage('Oops! Something went wrong...');
		}
	}
	getRoleName(role) {
		role = this.guild.roles.find(r => r.id == role);
		return role ? role.name : '';
	}
}

class Command {
	constructor(id, descriptor = {}) {
		if (!id) throw 'Command requires ID.';
		this.id = id;
		Object.assign(this, this.constructor.TEMPLATE, descriptor);
	}
	check(context) {
		if (this.private && !auth.admins.includes(context.user.id)) {
			return 'You are not authorized to use this command.';
		}
		if (this.guild && !context.guild) {
			return 'You must be in a guild to use this command.';
		}
		return;
	}
	resolve(context) {
		var err = this.check(context);
		if (err) {
			return Promise.reject(err);
		} else try {
			return Promise.resolve(this.run.call(this, context))
			.then(response => {
				if (this.title && response) {
					if (typeof response === 'object') {
						response.title = this.title + (response.title ? ' | ' + response.title : '');
					} else {
						response = '**' + this.title + '**\n' + response;
					}
				}
				return response;
			});
		} catch (e) {
			return Promise.reject(e);
		}
	}
	toString() {
		return PREFIX + this.id +
		(this.aliases.length ? '/' + this.aliases.join('/') : '') +
		(this.parameters.length ? ' ' + this.parameters.join(' ') : '');
	}
	get usage() {
		return `\`${this.toString()}\`: ${this.info}`;
	}
	embed() {
		return {
			title: 'Command: ' + quote(this.id),
			description: this.info || 'No information about this command.',
			fields: [
				{
					name: 'Usage',
					value: '`' + this.toString() + '`'
				},
				{
					name: 'Admin Only',
					value: this.private ? 'Yes' : 'No',
					inline: true
				},
				{
					name: 'Guild Only',
					value: this.guild ? 'Yes' : 'No',
					inlue: true
				}
			]
		};
	}
	
}
Command.TEMPLATE = {
	title: '',
	info: '',
	aliases: [],
	parameters: [],
	private: false,
	guild: false,
	run: function () {}
};

class Commands {
	static create(id, descriptor) {
		this._[id.toLowerCase()] = new Command(id, descriptor);
	}
	static get(id) {
		id = id.toLowerCase();
		for (var cmd in this._) {
			if (cmd == id || this._[cmd].aliases.includes(id)) {
				return this._[cmd];
			}
		}
	}
	static list() {
		return Object.keys(this._).map(cmd => this._[cmd].usage).join('\n\n');
	}
}
Commands._ = {};

Commands.create('help', {
	title: 'Usage',
	info: 'Provides a list of commands and help with command usage.',
	aliases: ['halp','ayuda','?'],
	parameters: ['[command]'],
	run: function ({args}) {
		var cmd = args[0];
		if (cmd) {
			var command = Commands.get(cmd);
			if (!command) {
				throw 'Invalid command: ' + cmd;
			}
			return command.embed();
		} else {
			return Commands.list();
		}
	}
});
Commands.create('get', {
	title: 'F-List - Get F-List Character',
	info: `Retrieve the F-List page for a character's kinks in order to assign the associated roles.
	▪ \`choice\` sets the kink choice tier: **fave**, **yes**, **maybe**, and **no**. Picking a tier includes all tiers before it.
	▪ If none of the kinks match, the default role is used.
	▪ For admins, include \`for @user\` at the end if you wish to assign the roles to another user.`,
	guild: true,
	aliases: ['do'],
	parameters: ['[character | url]', '[choice]', '[for @user]'],
	run: function ({context,client,args,guild,member}) {
		var targetMember = member;
		if (args[args.length-2] == 'for') {
			if (!auth.admins.includes(member.id)) {
				throw 'You are not authorized to use this for other users.';
			}
			var id = args.pop().match(/\d+/);
			targetMember = guild.members.find(m => m.id == id);
			args.pop();
		}
		var choice = args.pop();
		if (choice && FLIST_CHOICES.includes(choice)) {
			choice = FLIST_CHOICES.indexOf(choice);
		} else {
			args.push(choice);
			choice = 1;
		}
		var name = args.join(' ');
		
		return flist.getCharacter(name)
		.then(charData => flist.getAssignableRoles(charData, choice))
		.then(kinkMap => {
			var recognizedKinks = Object.keys(kinkMap);
			
			if (recognizedKinks.length) {
				recognizedKinks.forEach(roleID => targetMember.assignRole(roleID));
				return 'I assigned you some roles based on your F-List likes.';
			} else {
				roleID = auth['default'];
				if (roleID) {
					targetMember.assignRole(roleID);
					return 'I assigned you the default role.';
				} else {
					return 'Hmm, I don\'t recognize any kinks you have.';
				}
			}
		});
	}
});
Commands.create('test', {
	title: 'F-List - Applicable Roles',
	info: 'Retrieve the F-List page for a character\'s kinks, then list the applicable roles without assigning them.',
	guild: true,
	aliases: ['try','diagnose'],
	parameters: ['[character | url]', '[choice]'],
	run: function ({context,client,args,user}) {
		var choice = args.pop();
		if (choice && FLIST_CHOICES.includes(choice)) {
			choice = FLIST_CHOICES.indexOf(choice);
		} else {
			args.push(choice);
			choice = 1;
		}
		var name = args.join(' ');
		
		return flist.getCharacter(name)
		.then(charData => flist.getAssignableRoles(charData, choice))
		.then(kinkMap => {
			var e = {
				title: this.title + ' for ' + quote(name),
				description: '',
				color: FLIST_COLOR
			};
			for (var roleID in kinkMap) {
				e.description += '**__' + context.getRoleName(roleID) + '__** \n';
				e.description += kinkMap[roleID].map(k => flist.getKink(k).toString()).join('\n') + '\n';
			}
			if (!e.description) {
				e.description = 'No applicable roles.';
			}
			user.openDM().then(DM => DM.sendMessage('', false, e));
			return 'I sent you a list of roles applicable to the kinks found on that F-List.';
		});
	}
});

Commands.create('ilike', {
	title: 'I Like...',
	info: 'Assigns you the roles that are linked to the specified kinks/aliases.',
	aliases: ['ilove','addme','roleme'],
	parameters: ['[roles | kinks...]'],
	guild: true,
	run: function ({args,member}) {
		var roles = parseCSV(args).map(id => {
			var role = parseRole(id);
			if (Number(role)) return role;
			else return flist.getKinkRole(id);
		});
		roles.filter(Boolean).forEach(role => member.assignRole(role));
		return 'I have assigned you some roles based on your interests.';
	}
});
Commands.create('idislike', {
	title: 'I Dislike...',
	info: 'Removes you from the roles that are linked to the specified kinks/aliases.',
	aliases: ['ihate','removeme','unroleme'],
	parameters: ['[roles | kinks...]'],
	guild: true,
	run: function ({args,member}) {
		var roles = parseCSV(args).map(id => {
			var role = parseRole(id);
			if (Number(role)) return role;
			else return flist.getKinkRole(id);
		});
		roles.filter(Boolean).forEach(role => member.unassignRole(role));
		return 'I have removed some of your roles that you didn\'t like.';
	}
});
Commands.create('kinks', {
	title: 'F-List Kinks',
	info: 'Display a list of kink groups, or kinks in a specified group.',
	aliases: ['fetishes'],
	parameters: ['[group]'],
	run: function ({args}) {
		var specificKinkGroup = args.join(' ');
		if (specificKinkGroup) {
			var group = flist.getKinkGroup(specificKinkGroup);
			if (!group) {
				throw 'Unknown kink group: ' + quote(specificKinkGroup);
			}
			return group.embed();
		} else {
			return flist.embed();
		}
	}
});
Commands.create('kink', {
	title: 'F-List Kink',
	info: 'Retrieve a description of the specified kink, by name or ID.',
	aliases: ['fetish'],
	parameters: ['[kink]'],
	run: function ({args}) {
		var kinkName = args.join(' ');
		var kink = flist.getKink(kinkName);
		if (!kink) {
			throw 'Unknown kink: ' + quote(kinkName);
		}
		return kink.embed();
	}
});
Commands.create('search', {
	title: 'F-List - Search',
	info: 'Search for kinks matching the given keywords.',
	aliases: ['find', 'lookup', 'query'],
	parameters: ['[kink(s)]'],
	run: function ({args}) {
		var kinkQuery = parseCSV(args);
		var results = flist.search(kinkQuery);
		if (results.length) {
			return {
				title: 'F-List - Matches for ' + kinkQuery.map(quote).join(', '),
				description: results.map(kink => kink.toString()).join('\n')
			};
		} else {
			throw 'No kinks matched your query.';
		}
	}
});

Commands.create('alias', {
	title: 'Role Alias',
	info: 'Add, remove, and view aliases for roles.',
	private: true,
	guild: true,
	parameters: ['<add/set|remove/clear|view/list>','[role]','[aliases...]'],
	run: function ({context,args}) {
		var [method, role, ...aliases] = args;
		role = parseRole(role);
		aliases = parseCSV(aliases);
		switch (method) {
			case 'add':
			case 'set':
				if (!role) {
					throw 'Invalid role ID: ' + quote(role);
				}
				roleAliases[role] = roleAliases[role] || [];
				for (var a of aliases) {
					if (!roleAliases[role].find(ra => strcmp(ra,a))) {
						roleAliases[role].push(a);
					}
				}
				try {
					save('aliases', roleAliases);
					return 'Aliases updated for role ' + quote(context.getRoleName(role));
				} catch (e) {
					context.softError(e);
				}
				break;
			case 'remove':
			case 'clear':
				if (!role) {
					throw 'Invalid role ID: ' + quote(role);
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
					return 'Aliases updated for role ' + quote(context.getRoleName(role));
				} catch (e) {
					context.softError(e);
				}
				break;
			case 'view':
			case 'list':
				if (role) {
					var name = context.getRoleName(role);
					if (!(role in roleAliases)) {
						throw 'The role ' + quote(name) + ' does not have any aliases set.';
					}
					return {
						title: 'F-List - Aliases for ' + quote(name),
						description: roleAliases[role].join('\n')
					};
				} else {
					return {
						title: 'F-List - All Role Aliases',
						description: Object.keys(roleAliases).map(id => {
							var name = context.getRoleName(id);
							return name + ' => ' + roleAliases[id].join(', ');
						}).join('\n')
					};
				}
				break;
		}
	}
});
Commands.create('assign', {
	title: 'F-List - Assign Kinks to Role',
	info: 'Assign kinks, delimited by commas, to the given role.',
	private: true,
	guild: true,
	aliases: ['add','link','map'],
	parameters: ['[role]','[kink(s)...]'],
	run: function ({context,args}) {
		var [role, ...kinks] = args;
		role  = parseRole(role);
		kinks = parseCSV(kinks);
		if (!role) {
			throw 'Invalid role ID: ' + quote(role);
		}
		kinkRoleMap[role] = kinkRoleMap[role] || [];
		for (var kinkID of kinks) {
			var kink = flist.getKink(kinkID);
			if (!kink) {
				throw 'Invalid kink: ' + quote(kinkID);
			}
			
			if (!kinkRoleMap[role].includes(kink.id)) {
				kinkRoleMap[role].push(kink.id);
			} else {
				console.log('Kink already assigned:',kink.id,'/',kink.name);
			}
		}
		try {
			save('kinks', kinkRoleMap);
			return 'Kink map successfully updated.';
		} catch (e) {
			context.softError(e);
		}
	}
});
Commands.create('unassign', {
	title: 'F-List - Unassign Kinks from Role',
	info: 'Delete mapped kinks, delimited by commas, from the given role.',
	private: true,
	guild: true,
	aliases: ['remove','unlink','unmap'],
	parameters: ['[role]','[kink(s)...]'],
	run: function ({context,args}) {
		var [role, ...kinks] = args;
		role  = parseRole(role);
		kinks = parseCSV(kinks);
		if (!role) {
			throw 'Invalid role ID: ' + quote(role);
		}
		kinkRoleMap[role] = kinkRoleMap[role] || [];
		for (var kinkID of kinks) {
			var kink = flist.getKink(kinkID);
			if (!kink) {
				throw 'Invalid kink: ' + quote(kinkID);
			}
			
			var idx = kinkRoleMap[role].findIndex(id => id == kink.name || id == kink.id);
			if (idx > -1) {
				kinkRoleMap[role].splice(idx, 1);
			} else {
				console.log('Kink not found:',kink.id,'/',kink.name);
			}
		}
		try {
			save('kinks', kinkRoleMap);
			return 'Kink map successfully updated.';
		} catch (e) {
			context.softError(e);
		}
	}
});
Commands.create('assigned', {
	title: 'F-List - Assigned Kinks',
	info: 'View kinks assigned to a role.',
	private: true,
	guild: true,
	aliases: ['view','linked','mapped'],
	parameters: ['[role]'],
	run: function ({context,args}) {
		var role = parseRole(args.slice(1).join(' '));
		var name = context.getRoleName(role);
		if (role || name) {
			if (name) {
				if (role in kinkRoleMap) {
					var e = {
						title: quote(name),
						description: kinkRoleMap[role].map(kink => {
							return flist.getKink(kink).toString();
						}).join('\n')
					};
					return e;
				} else {
					return 'There are no kinks assigned to ' + quote(name);
				}
			} else {
				throw 'Invalid role ID: ' + quote(role);
			}
		} else {
			var e = {
				description: '',
				fields: []
			};
			for (role in kinkRoleMap) {
				e.fields.push({
					name: context.getRoleName(role),
					value: kinkRoleMap[role].map(kink => {
						return flist.getKink(kink).toString();
					}).join('\n'),
					inline: true
				});
			}
			return e;
		}
	}
});
Commands.create('default', {
	title: 'Default Role',
	info: 'Gets or sets the default role, which is assigned when no other applicable roles are decided.',
	private: true,
	guild: true,
	parameters: ['[role]'],
	run: function ({context,args}) {
		var role = parseRole(args.slice(1).join(' '));
		var name = context.getRoleName(role);
		if (role || name) {
			if (!name) {
				throw 'Invalid role name or ID: ' + role;
			}
			auth['default'] = role;
			try {
				save('auth', auth);
			} catch (e) {
				context.softError(e);
			}
		} else {
			role = auth['default'];
			name = role && context.getRoleName(role);
		}
		return '**' + (name || '(Not set)') + '**';
	}
});
Commands.create('cleanup', {
	info: 'Removes a number of messages in the channel.',
	private: true,
	aliases: ['prune','tidy','purge','nuke'],
	run: function ({client,args,channel}) {
		var count = args[0] || 50;
		console.log('Deleting',count,'messages in',channel.id);
		return channel.fetchMessages(Number(count))
		.then(response => client.Messages.deleteMessages(response.messages));
	}
});
Commands.create('exit', {
	info: 'Stops running the bot.',
	private: true,
	aliases: ['stop','quit','abort','gtfo'],
	run: function ({client}) {
		client.disconnect();
		process.exit(0);
	}
});

const client = new Discordie({
	autoReconnect: true
});

client.connect({
	token: auth.token,
	autorun: true
});
client.Dispatcher.on('GATEWAY_READY', () => {
	client.User.setGame(PREFIX + 'help');
	console.log('FListBot connected.');
});
client.Dispatcher.on('MESSAGE_CREATE', (response) => {
	var context = new Context(response, client);
	
	if (context.user.id === client.User.id || !context.command) return;
	var command = Commands.get(context.cmd);
	if (!command) return;
	console.log('Command:',context.command);
	
	return command.resolve(context).then(response => {
		if (typeof response === 'object') {
			if (response.title || response.description || response.fields || response.url || response.image) {
				response.color = FLIST_COLOR;
				return context.channel.sendMessage('', false, response);
			}
		} else if (response) {
			return context.channel.sendMessage(response);
		}
	}).catch(err => context.handleError(err));
});

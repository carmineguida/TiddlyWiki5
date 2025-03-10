/*\
title: $:/core/modules/widgets/transclude.js
type: application/javascript
module-type: widget

Transclude widget

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var TranscludeWidget = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

/*
Inherit from the base widget class
*/
TranscludeWidget.prototype = new Widget();

/*
Render this widget into the DOM
*/
TranscludeWidget.prototype.render = function(parent,nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	this.renderChildren(parent,nextSibling);
};

/*
Compute the internal state of the widget
*/
TranscludeWidget.prototype.execute = function() {
	// Get our attributes, string parameters, and slot values into properties of the widget object
	this.collectAttributes();
	this.collectStringParameters();
	this.collectSlotFillParameters();
	// Get the parse tree nodes that we are transcluding
	var target = this.getTransclusionTarget(),
		parseTreeNodes = target.parseTreeNodes;
	this.sourceText = target.text;
	this.sourceType = target.type;
	this.parseAsInline = target.parseAsInline;
	// Process the transclusion according to the output type
	switch(this.transcludeOutput || "text/html") {
		case "text/html":
			// No further processing required
			break;
		case "text/raw":
			// Just return the raw text
			parseTreeNodes = [{type: "text", text: this.sourceText}];
			break;
		default:
			// text/plain
			var plainText = this.wiki.renderText("text/plain",this.sourceType,this.sourceText,{parentWidget: this});
			parseTreeNodes = [{type: "text", text: plainText}];
			break;
	}
	// Set the legacy transclusion context variables only if we're not transcluding a variable
	if(!this.transcludeVariable) {
		var recursionMarker = this.makeRecursionMarker();
		this.setVariable("transclusion",recursionMarker);
	}
	// Construct the child widgets
	this.makeChildWidgets(parseTreeNodes);
};

/*
Collect the attributes we need, in the process determining whether we're being used in legacy mode
*/
TranscludeWidget.prototype.collectAttributes = function() {
	var self = this;
	// Detect legacy mode
	this.legacyMode = true;
	$tw.utils.each(this.attributes,function(value,name) {
		if(name.charAt(0) === "$") {
			self.legacyMode = false;
		}
	});
	// Get the attributes for the appropriate mode
	if(this.legacyMode) {
		this.transcludeTitle = this.getAttribute("tiddler",this.getVariable("currentTiddler"));
		this.transcludeSubTiddler = this.getAttribute("subtiddler");
		this.transcludeField = this.getAttribute("field");
		this.transcludeIndex = this.getAttribute("index");
		this.transcludeMode = this.getAttribute("mode");
		this.recursionMarker = this.getAttribute("recursionMarker","yes");
	} else {
		this.transcludeVariable = this.getAttribute("$variable");
		this.transcludeType = this.getAttribute("$type");
		this.transcludeOutput = this.getAttribute("$output","text/html");
		this.transcludeTitle = this.getAttribute("$tiddler",this.getVariable("currentTiddler"));
		this.transcludeSubTiddler = this.getAttribute("$subtiddler");
		this.transcludeField = this.getAttribute("$field");
		this.transcludeIndex = this.getAttribute("$index");
		this.transcludeMode = this.getAttribute("$mode");
		this.recursionMarker = this.getAttribute("$recursionMarker","yes");
	}
};

/*
Collect string parameters
*/
TranscludeWidget.prototype.collectStringParameters = function() {
	var self = this;
	this.stringParametersByName = Object.create(null);
	if(!this.legacyMode) {
		$tw.utils.each(this.attributes,function(value,name) {
			if(name.charAt(0) === "$") {
				if(name.charAt(1) === "$") {
					// Attributes starting $$ represent parameters starting with a single $
					name = name.slice(1);
				} else {
					// Attributes starting with a single $ are reserved for the widget
					return;
				}
			}
			self.stringParametersByName[name] = value;
		});
	}
};

/*
Collect slot value parameters
*/
TranscludeWidget.prototype.collectSlotFillParameters = function() {
	var self = this;
	this.slotFillParseTrees = Object.create(null);
	if(this.legacyMode) {
		this.slotFillParseTrees["ts-missing"] = this.parseTreeNode.children;
	} else {
		this.slotFillParseTrees["ts-raw"] = this.parseTreeNode.children;
		var noFillWidgetsFound = true,
			searchParseTreeNodes = function(nodes) {
				$tw.utils.each(nodes,function(node) {
					if(node.type === "fill") {
						if(node.attributes["$name"] && node.attributes["$name"].type === "string") {
							var slotValueName = node.attributes["$name"].value;
							self.slotFillParseTrees[slotValueName] = node.children || [];
						}
						noFillWidgetsFound = false;
					} else {
						searchParseTreeNodes(node.children);
					}
				});
			};
		searchParseTreeNodes(this.parseTreeNode.children);
		if(noFillWidgetsFound) {
			this.slotFillParseTrees["ts-missing"] = this.parseTreeNode.children;
		}
	}
};

/*
Get transcluded parse tree nodes as an object {parser:,text:,type:}
*/
TranscludeWidget.prototype.getTransclusionTarget = function() {
	var self = this;
	// Determine whether we're being used in inline or block mode
	var parseAsInline = !this.parseTreeNode.isBlock;
	if(this.transcludeMode === "inline") {
		parseAsInline = true;
	} else if(this.transcludeMode === "block") {
		parseAsInline = false;
	}
	var parser;
	// Get the parse tree
	if(this.transcludeVariable) {
		// Transcluding a variable
		var variableInfo = this.getVariableInfo(this.transcludeVariable,{params: this.getOrderedTransclusionParameters()}),
			srcVariable = variableInfo && variableInfo.srcVariable;
		if(srcVariable) {
			if(srcVariable.isFunctionDefinition) {
				// Function to return parameters by name or position
				var fnGetParam = function(name,index) {
						// Parameter names starting with dollar must be escaped to double dollars
						if(name.charAt(0) === "$") {
							name = "$" + name;
						}
						// Look for the parameter by name
						if(self.hasAttribute(name)) {
							return self.getAttribute(name);
						// Look for the parameter by index
						} else if(self.hasAttribute(index + "")) {
							return self.getAttribute(index + "");
						} else {
							return undefined;
						}
					},
					result = this.evaluateVariable(this.transcludeVariable,{params: fnGetParam})[0] || "";
				parser = {
					tree: [{
						type: "text",
						text: result
					}],
					source: result,
					type: "text/vnd.tiddlywiki"
				};
				if(parseAsInline) {
					parser.tree[0] = {
						type: "text",
						text: result
					};
				} else {
					parser.tree[0] = {
						type: "element",
						tag: "p",
						children: [{
							type: "text",
							text: result
						}]
					}
				}
			} else {
				var cacheKey = (parseAsInline ? "inlineParser" : "blockParser") + (this.transcludeType || "");
				if(variableInfo.isCacheable && srcVariable[cacheKey]) {
					parser = srcVariable[cacheKey];
				} else {
					parser = this.wiki.parseText(this.transcludeType,variableInfo.text || "",{parseAsInline: parseAsInline, configTrimWhiteSpace: srcVariable.configTrimWhiteSpace});
					if(variableInfo.isCacheable) {
						srcVariable[cacheKey] = parser;
					}
				}
			}
			if(parser) {
				// Add parameters widget for procedures and custom widgets
				if(srcVariable.isProcedureDefinition || srcVariable.isWidgetDefinition) {
					parser = {
						tree: [
							{
								type: "parameters",
								children: parser.tree
							}
						],
						source: parser.source,
						type: parser.type
					}
					$tw.utils.each(srcVariable.params,function(param) {
						var name = param.name;
						// Parameter names starting with dollar must be escaped to double dollars
						if(name.charAt(0) === "$") {
							name = "$" + name;
						}
						$tw.utils.addAttributeToParseTreeNode(parser.tree[0],name,param["default"])
					});
				} else {
					// For macros and ordinary variables, wrap the parse tree in a vars widget assigning the parameters to variables named "__paramname__"
					parser = {
						tree: [
							{
								type: "vars",
								children: parser.tree
							}
						],
						source: parser.source,
						type: parser.type
					}
					$tw.utils.each(variableInfo.params,function(param) {
						$tw.utils.addAttributeToParseTreeNode(parser.tree[0],"__" + param.name + "__",param.value)
					});
				}
			}
		}
	} else {
		// Transcluding a text reference
		parser = this.wiki.parseTextReference(
						this.transcludeTitle,
						this.transcludeField,
						this.transcludeIndex,
						{
							parseAsInline: parseAsInline,
							subTiddler: this.transcludeSubTiddler,
							defaultType: this.transcludeType
						});
	}
	// Set 'thisTiddler'
	this.setVariable("thisTiddler",this.transcludeTitle);
	// Return the parse tree
	if(parser) {
		return {
			parser: parser,
			parseTreeNodes: parser.tree,
			parseAsInline: parseAsInline,
			text: parser.source,
			type: parser.type
		};
	} else {
		// If there's no parse tree then return the missing slot value
		return {
			parser: null,
			parseTreeNodes: (this.slotFillParseTrees["ts-missing"] || []),
			parseAsInline: parseAsInline,
			text: null,
			type: null
		};
	}
};

/*
Fetch all the string parameters as an ordered array of {name:, value:} where the name is optional
*/
TranscludeWidget.prototype.getOrderedTransclusionParameters = function() {
	var result = [];
	// Collect the parameters
	for(var name in this.stringParametersByName) {
		var value = this.stringParametersByName[name];
		result.push({name: name, value: value});
	}
	// Sort numerical parameter names first
	result.sort(function(a,b) {
		var aIsNumeric = !isNaN(a.name),
			bIsNumeric = !isNaN(b.name);
		if(aIsNumeric && bIsNumeric) {
			return a.name - b.name;
		} else if(aIsNumeric) {
			return -1;
		} else if(bIsNumeric) {
			return 1;
		} else {
			return a.name === b.name ? 0 : (a.name < b.name ? -1 : 1);
		}
	});
	// Remove names from numerical parameters
	$tw.utils.each(result,function(param,index) {
		if(!isNaN(param.name)) {
			delete param.name;
		}
	});
	return result;
};

/*
Fetch the value of a parameter
*/
TranscludeWidget.prototype.getTransclusionParameter = function(name,index,defaultValue) {
	if(name in this.stringParametersByName) {
		return this.stringParametersByName[name];
	} else {
		var name = "" + index;
		if(name in this.stringParametersByName) {
			return this.stringParametersByName[name];
		}
	}
	return defaultValue;
};

/*
Get one of the special parameters to be provided by the parameters widget
*/
TranscludeWidget.prototype.getTransclusionMetaParameters = function() {
	var self = this;
	return {
		"parseMode": function() {
			return self.parseAsInline ? "inline" : "block";
		},
		"parseTreeNodes": function() {
			return JSON.stringify(self.parseTreeNode.children || []);
		},
		"slotFillParseTreeNodes": function() {
			return JSON.stringify(self.slotFillParseTrees);
		},
		"params": function() {
			return JSON.stringify(self.stringParametersByName);
		}
	};
};

/*
Fetch the value of a slot
*/
TranscludeWidget.prototype.getTransclusionSlotFill = function(name,defaultParseTreeNodes) {
	if(name && this.slotFillParseTrees[name] && this.slotFillParseTrees[name].length > 0) {
		return this.slotFillParseTrees[name];
	} else {
		return defaultParseTreeNodes || [];
	}
};

/*
Compose a string comprising the title, field and/or index to identify this transclusion for recursion detection
*/
TranscludeWidget.prototype.makeRecursionMarker = function() {
	var output = [];
	output.push("{");
	output.push(this.getVariable("currentTiddler",{defaultValue: ""}));
	output.push("|");
	output.push(this.transcludeTitle || "");
	output.push("|");
	output.push(this.transcludeField || "");
	output.push("|");
	output.push(this.transcludeIndex || "");
	output.push("|");
	output.push(this.transcludeSubTiddler || "");
	output.push("}");
	return output.join("");
};

TranscludeWidget.prototype.parserNeedsRefresh = function() {
	// Doesn't need to consider transcluded variables because a parent variable can't change once a widget has been created
	var parserInfo = this.wiki.getTextReferenceParserInfo(this.transcludeTitle,this.transcludeField,this.transcludeIndex,{subTiddler:this.transcludeSubTiddler});
	return (this.sourceText === undefined || parserInfo.sourceText !== this.sourceText || parserInfo.parserType !== this.parserType)
};

/*
Selectively refreshes the widget if needed. Returns true if the widget or any of its children needed re-rendering
*/
TranscludeWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(($tw.utils.count(changedAttributes) > 0) || (!this.transcludeVariable && changedTiddlers[this.transcludeTitle] && this.parserNeedsRefresh())) {
		this.refreshSelf();
		return true;
	} else {
		return this.refreshChildren(changedTiddlers);
	}
};

exports.transclude = TranscludeWidget;

})();

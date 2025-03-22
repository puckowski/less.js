import Node from './node';
import Selector from './selector';
import Ruleset from './ruleset';
import Anonymous from './anonymous';
import NestableAtRulePrototype from './nested-at-rule';

const AtRule = function(
    name,
    value,
    rules,
    index,
    currentFileInfo,
    debugInfo,
    isRooted,
    visibilityInfo
) {
    let i;
    var selectors = (new Selector([], null, null, this._index, this._fileInfo)).createEmptySelectors();

    this.name  = name;
    this.value = (value instanceof Node) ? value : (value ? new Anonymous(value) : value);
    if (rules) {
        if (Array.isArray(rules)) {
            const allDeclarations = rules.filter(function (node) { return node.type === 'Declaration'; }).length === rules.length;
            let allDeclarations2 = true;
            rules.forEach(rule => {
                if (rule.rules) allDeclarations2 = allDeclarations2 && rule.rules.filter(function (node) { return node.type === 'Declaration'; }).length === rule.rules.length
            });
            if (allDeclarations && !isRooted) {
                this.simpleBlock = true;
                this.declarations = rules;
            }
            else if (allDeclarations2 && !isRooted && !value) {
                this.simpleBlock = true;
                this.declarations = rules[0].rules;
            }
            else {
                this.rules = rules;
            }
        } else {
            const allDeclarations = rules.rules.filter(function (node) { return node.type === 'Declaration' && !node.merge}).length === rules.rules.length;
            if (allDeclarations && !isRooted && !value) {
                this.simpleBlock = true;
                this.declarations = rules.rules;
            }
            else {
                this.rules = [rules];
                this.rules[0].selectors = (new Selector([], null, null, index, currentFileInfo)).createEmptySelectors();
            }
        }
        if (!this.simpleBlock) {
            for (i = 0; i < this.rules.length; i++) {
                this.rules[i].allowImports = true;
            }
        }
        this.setParent(selectors, this);
        this.setParent(this.rules, this);
    }
    this._index = index;
    this._fileInfo = currentFileInfo;
    this.debugInfo = debugInfo;
    this.isRooted = isRooted || false;
    this.copyVisibilityInfo(visibilityInfo);
    this.allowRoot = true;
}

AtRule.prototype = Object.assign(new Node(), {
    type: 'AtRule',

    ...NestableAtRulePrototype,

    accept(visitor) {
        const value = this.value, rules = this.rules, declarations = this.declarations;

        if (rules) {
            this.rules = visitor.visitArray(rules);
        }
        else if (declarations) {
            this.declarations = visitor.visitArray(declarations);   
        }
        if (value) {
            this.value = visitor.visit(value);
        }
    },

    isRulesetLike() {
        return this.rules || !this.isCharset();
    },

    isCharset() {
        return '@charset' === this.name;
    },

    genCSS(context, output) {
        const value = this.value, rules = this.rules || this.declarations;
        output.add(this.name, this.fileInfo(), this.getIndex());
        if (value) {
            output.add(' ');
            value.genCSS(context, output);
        }
        if (this.simpleBlock) {
            this.outputRuleset(context, output, this.declarations);
        } else if (rules) {
            this.outputRuleset(context, output, rules);
        } else {
            output.add(';');
        }
    },

    eval(context) {
        let mediaPathBackup, mediaBlocksBackup, value = this.value, rules = this.rules || this.declarations;
 
        // media stored inside other atrule should not bubble over it
        // backpup media bubbling information
        mediaPathBackup = context.mediaPath;
        mediaBlocksBackup = context.mediaBlocks;
        // deleted media bubbling information
        context.mediaPath = [];
        context.mediaBlocks = [];

        if (value) {
            value = value.eval(context);
        }

        let ampersandCount = 0;
        let noAmpersandCount = 0;
        let noAmpersands = true;
        let allAmpersands = false;

        if (rules) {
            if (!this.simpleBlock) {
                rules = [rules[0].eval(context)];
            }

            let precedingSelectors = [];

            if (context.frames.length > 0) {
                let index = 0;
                for (index = 0; index < context.frames.length; index++) {
                    if (
                        context.frames[index].type === 'Ruleset' &&
                        context.frames[index].rules &&
                        context.frames[index].rules.length > 0
                    ) {
                        let current = context.frames[index];

                        if (current && !current.root && current.selectors && current.selectors.length > 0 ) {
                            precedingSelectors = precedingSelectors.concat(current.selectors);
                        }
                    }

                    if (precedingSelectors.length > 0 ) {
                        let value = '';
                        const output = { add: function (s) { value += s; } };
                        for (let i = 0; i < precedingSelectors.length; i++) {
                            precedingSelectors[i].genCSS(context, output);
                        }
                        if (/^&+$/.test(value.replace(/\s+/g, ''))) {
                            noAmpersands = false;
                            noAmpersandCount++;
                        } else {
                            allAmpersands = false;
                            ampersandCount++;
                        }
                    }
                }
            }

            const mixedAmpersands = ampersandCount > 0 && noAmpersandCount > 0 && !allAmpersands && !noAmpersands;

            if (
                (this.isRooted && ampersandCount > 0 && noAmpersandCount === 0 && !allAmpersands && noAmpersands)
                || !mixedAmpersands
            ) {
                rules[0].root = true;
            }
        }

        if (this.simpleBlock && rules) {
            rules[0].functionRegistry = context.frames[0].functionRegistry.inherit();

            rules= rules.map(function (rule) { return rule.eval(context); });
            context.mediaPath = mediaPathBackup;
            context.mediaBlocks = mediaBlocksBackup;
            return  new AtRule(this.name, value, rules, this.getIndex(), this.fileInfo(), this.debugInfo, this.isRooted, this.visibilityInfo());
        } else {
            // restore media bubbling information
            context.mediaPath = mediaPathBackup;
            context.mediaBlocks = mediaBlocksBackup;
            return new AtRule(this.name, value, rules, this.getIndex(), this.fileInfo(), this.debugInfo, this.isRooted, this.visibilityInfo());
        }
    },

    variable(name) {
        if (this.rules) {
            // assuming that there is only one rule at this point - that is how parser constructs the rule
            return Ruleset.prototype.variable.call(this.rules[0], name);
        }
    },

    find() {
        if (this.rules) {
            // assuming that there is only one rule at this point - that is how parser constructs the rule
            return Ruleset.prototype.find.apply(this.rules[0], arguments);
        }
    },

    rulesets() {
        if (this.rules) {
            // assuming that there is only one rule at this point - that is how parser constructs the rule
            return Ruleset.prototype.rulesets.apply(this.rules[0]);
        }
    },

    outputRuleset(context, output, rules) {
        const ruleCnt = rules.length;
        let i;
        context.tabLevel = (context.tabLevel | 0) + 1;

        // Compressed
        if (context.compress) {
            output.add('{');
            for (i = 0; i < ruleCnt; i++) {
                rules[i].genCSS(context, output);
            }
            output.add('}');
            context.tabLevel--;
            return;
        }

        // Non-compressed
        const tabSetStr = `\n${Array(context.tabLevel).join('  ')}`, tabRuleStr = `${tabSetStr}  `;
        if (!ruleCnt) {
            output.add(` {${tabSetStr}}`);
        } else {
            output.add(` {${tabRuleStr}`);
            rules[0].genCSS(context, output);
            for (i = 1; i < ruleCnt; i++) {
                output.add(tabRuleStr);
                rules[i].genCSS(context, output);
            }
            output.add(`${tabSetStr}}`);
        }

        context.tabLevel--;
    }
});

export default AtRule;

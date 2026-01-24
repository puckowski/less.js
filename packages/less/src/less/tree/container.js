import Ruleset from './ruleset';
import Value from './value';
import Selector from './selector';
import AtRule from './atrule';
import Anonymous from './anonymous';
import Expression from './expression';
import NestableAtRulePrototype from './nested-at-rule';
import * as utils from '../utils';

const reservedContainerNameKeywords = new Set(['and', 'or', 'not']);

const isContainerNameCandidate = function(node) {
    if (!node) {
        return false;
    }
    if (node.type === 'Keyword') {
        const value = String(node.value).toLowerCase();
        return !reservedContainerNameKeywords.has(value);
    }
    return node.type === 'Anonymous' || node.type === 'Variable' || node.type === 'Quoted';
};

const isContainerQueryContinuation = function(node) {
    if (!node) {
        return false;
    }
    if (node.type === 'Paren') {
        return true;
    }
    if (node.type === 'Keyword' || node.type === 'Anonymous') {
        const value = String(node.value).toLowerCase();
        return reservedContainerNameKeywords.has(value);
    }
    return false;
};

const inferContainerNameAndFeatures = function(features) {
    if (!Array.isArray(features) || features.length === 0) {
        return { name: null, features, nameNoSpacing: false };
    }

    const first = features[0];

    if (first instanceof Expression && Array.isArray(first.value) && first.value.length > 0) {
        const nameNode = first.value[0];
        if (isContainerNameCandidate(nameNode)) {
            const nameNoSpacing = Boolean(first.value[1] && first.value[1].noSpacing);
            if (first.value.length === 1) {
                return { name: nameNode, features: features.slice(1), nameNoSpacing };
            }

            if (isContainerQueryContinuation(first.value[1])) {
                const remainingExpression = new Expression(first.value.slice(1), first.noSpacing);
                remainingExpression.parens = first.parens;
                remainingExpression.parensInOp = first.parensInOp;

                return {
                    name: nameNode,
                    features: [remainingExpression].concat(features.slice(1)),
                    nameNoSpacing
                };
            }
        }
    }

    if (isContainerNameCandidate(first) && features.length === 1) {
        return { name: first, features: [], nameNoSpacing: false };
    }

    return { name: null, features, nameNoSpacing: false };
};

const Container = function(value, features, index, currentFileInfo, visibilityInfo) {
    this._index = index;
    this._fileInfo = currentFileInfo;

    const selectors = (new Selector([], null, null, this._index, this._fileInfo)).createEmptySelectors();

    const inferred = inferContainerNameAndFeatures(features);

    this.name = inferred.name || null;
    this._nameNoSpacing = inferred.nameNoSpacing;
    this.features = new Value(inferred.features);
    this.rules = [new Ruleset(selectors, value)];
    this.rules[0].allowImports = true;
    this.copyVisibilityInfo(visibilityInfo);
    this.allowRoot = true;
    this.setParent(selectors, this);
    this.setParent(this.name, this);
    this.setParent(this.features, this);
    this.setParent(this.rules, this);
};

Container.prototype = Object.assign(new AtRule(), {
    type: 'Container',

    ...NestableAtRulePrototype,

    genCSS(context, output) {
        output.add('@container ', this._fileInfo, this._index);
        if (this.name) {
            this.name.genCSS(context, output);
            if (!this._nameNoSpacing) {
                output.add(' ');
            }
        }
        this.features.genCSS(context, output);
        this.outputRuleset(context, output, this.rules);
    },

    eval(context) {
        if (this._evaluated) {
            return this;
        }
        if (!context.mediaBlocks) {
            context.mediaBlocks = [];
            context.mediaPath = [];
        }

        const media = new Container(null, [], this._index, this._fileInfo, this.visibilityInfo());
        media._evaluated = true;
        if (this.debugInfo) {
            this.rules[0].debugInfo = this.debugInfo;
            media.debugInfo = this.debugInfo;
        }

        media.name = this.name;
        media._nameNoSpacing = this._nameNoSpacing;
        media.setParent(media.name, media);
        if (this.name && this.name.eval) {
            media.name = this.name.eval(context);
            media.setParent(media.name, media);
        }

        media.features = this.features.eval(context);

        context.mediaPath.push(media);
        context.mediaBlocks.push(media);

        this.rules[0].functionRegistry = context.frames[0].functionRegistry.inherit();
        context.frames.unshift(this.rules[0]);
        media.rules = [this.rules[0].eval(context)];
        context.frames.shift();

        context.mediaPath.pop();

        return context.mediaPath.length === 0 ? media.evalTop(context) :
            media.evalNested(context);
    },

    evalNested(context) {
        this.evalFunction();

        let i;
        let value;
        const path = context.mediaPath.concat([this]);

        // Extract the container-query conditions separated with `,` (OR),
        // and include any container names in the feature list.
        for (i = 0; i < path.length; i++) {
            if (path[i].type !== this.type) {
                context.mediaBlocks.splice(i, 1);
                return this;
            }

            const nameNode = path[i].name;
            value = path[i].features instanceof Value ?
                path[i].features.value : path[i].features;
            const fragments = Array.isArray(value) ? value : [value];
            if (nameNode) {
                path[i] = fragments.map(fragment => new Expression([nameNode, fragment]));
            } else {
                path[i] = fragments;
            }
        }

        // Trace all permutations to generate the resulting container-query.
        this.features = new Value(this.permute(path).map(path => {
            path = path.map(fragment => fragment.toCSS ? fragment : new Anonymous(fragment));

            for (i = path.length - 1; i > 0; i--) {
                path.splice(i, 0, new Anonymous('and'));
            }

            return new Expression(path);
        }));
        this.setParent(this.features, this);
        this.name = null;

        // Fake a tree-node that doesn't output anything.
        return new Ruleset([], []);
    },

    permute(arr) {
        if (arr.length === 0) {
            return [];
        } else if (arr.length === 1) {
            return arr[0];
        } else {
            const result = [];
            const rest = this.permute(arr.slice(1));
            for (let i = 0; i < rest.length; i++) {
                for (let j = 0; j < arr[0].length; j++) {
                    result.push([arr[0][j]].concat(rest[i]));
                }
            }
            return result;
        }
    },

    bubbleSelectors(selectors) {
        if (!selectors) {
            return;
        }
        this.rules = [new Ruleset(utils.copyArray(selectors), [this.rules[0]])];
        this.setParent(this.rules, this);
    }
});

export default Container;

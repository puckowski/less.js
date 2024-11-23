import Value from './value';
import Selector from './selector';
import AtRule from './atrule';
import NestableAtRulePrototype from './nested-at-rule';
import Anonymous from './anonymous';
import Expression from './expression';

const StartingStyle = function(value, features, index, currentFileInfo, visibilityInfo) {
    this._index = index;
    this._fileInfo = currentFileInfo;

    const selectors = (new Selector([], null, null, this._index, this._fileInfo)).createEmptySelectors();

    this.features = new Value(features);
    this.declarations = value;
    this.copyVisibilityInfo(visibilityInfo);
    this.allowRoot = true;
    this.setParent(selectors, this);
    this.setParent(this.features, this);
    this.setParent(this.declarations, this);
};

StartingStyle.prototype = Object.assign(new AtRule(), {
    type: 'StartingStyle',

    ...NestableAtRulePrototype,

    genCSS(context, output) {
        output.add('@starting-style', this._fileInfo, this._index);
        context.firstSelector = true;
        this.features.genCSS(context, output);
        this.outputRuleset(context, output, this.declarations);
    },

    eval(context) {
        if (!context.mediaBlocks) {
            context.mediaBlocks = [];
            context.mediaPath = [];
        }

        const media = new StartingStyle(null, [], this._index, this._fileInfo, this.visibilityInfo());
        if (this.debugInfo) {
            this.declarations[0].debugInfo = this.debugInfo;
            media.debugInfo = this.debugInfo;
        }
        
        media.features = this.features.eval(context);

        this.declarations[0].functionRegistry = context.frames[0].functionRegistry.inherit();
        context.frames.unshift(this.declarations[0]);
        media.declarations = this.declarations.map(rule => rule.eval(context));
        context.frames.shift();

        return context.mediaPath.length == 0 ? media.evalTop(context) :
            media.evalNested(context);
    },

    evalNested: function (context) {
        var i;
        var value;
        var path = context.mediaPath.concat([this]);
        // Extract the media-query conditions separated with `,` (OR).
        for (i = 0; i < path.length; i++) {
            value = path[i].features instanceof Value ?
                path[i].features.value : path[i].features;
            path[i] = Array.isArray(value) ? value : [value];
        }
        // Trace all permutations to generate the resulting media-query.
        //
        // (a, b and c) with nested (d, e) ->
        //    a and d
        //    a and e
        //    b and c and d
        //    b and c and e
        this.features = new Value(this.permute(path).map(function (path) {
            path = path.map(function (fragment) { return fragment.toCSS ? fragment : new Anonymous(fragment); });
            for (i = path.length - 1; i > 0; i--) {
                path.splice(i, 0, new Anonymous('and'));
            }
            return new Expression(path);
        }));
        this.setParent(this.features, this);
        // Fake a tree-node that doesn't output anything.
        return new StartingStyle(this.declarations, this.features, this._index, this._fileInfo, this.visibilityInfo());
    },
});

export default StartingStyle;

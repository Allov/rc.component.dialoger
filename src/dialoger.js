// Copyright (c) CBC/Radio-Canada. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import ko from 'knockout';
import _ from 'lodash';
import koco from 'koco';
import $ from 'jquery';


//var KEYCODE_ENTER = 13;
var KEYCODE_ESC = 27;

function Dialoger() {
    var self = this;

    ko.components.register('dialoger', {
        isBower: true,
        htmlOnly: true
    });

    self.dialogConfigs = [];
    self.loadedDialogs = ko.observableArray([]);

    self.currentDialog = ko.computed(function() {
        var loadedDialogs = self.loadedDialogs();

        if (loadedDialogs.length) {
            return loadedDialogs[loadedDialogs.length - 1];
        }

        return null;
    });

    self.isDialogOpen = ko.computed(function() {
        return !!self.currentDialog();
    });

    self.isDialogOpen.subscribe(function(isDialogOpen) {
        registerOrUnregisterHideDialogKeyboardShortcut(self, isDialogOpen);
    });

    self.currentDialogTitle = ko.computed(function() {
        var currentDialog = self.currentDialog();

        if (currentDialog) {
            return currentDialog.title;
        }

        return '';
    });
}

var defaultConfig = {
    allowNavigation: false
};


Dialoger.prototype.init = function(config) {
    var self = this;
    self.config = Object.assign({}, defaultConfig, config);

    // TODO: Passer $dialogElement en argument au lieu?
    /* self.dialogElement = */ getDialogElement();

    koco.router.navigating.subscribe(this.canNavigate, this);
};

Dialoger.prototype.canNavigate = function(options) {

    // We assume that no links are possible in a dialog and the only navigation possible
    // would be by the back button.
    // So, in that case, we cancel navigation and simply close the dialog.
    var self = this;
    var currentDialog = this.currentDialog();

    if ((_.isUndefined(options.replace) || options.replace === false) && !_.isUndefined(self.config.allowNavigation) && self.config.allowNavigation === true) {
        while (self.isDialogOpen()) {
            this.currentDialog().settings.close(null);
        }
        return true;
    } else {
        if (currentDialog) {
            currentDialog.settings.close(null);
            return false;
        }
    }

    return true;
};

Dialoger.prototype.show = function(name, params) {
    var self = this;
    return new $.Deferred(function(dfd) {
        try {
            var dialogConfigToShow = findByName(self.dialogConfigs, name);

            if (!dialogConfigToShow) {
                throw new Error('Dialoger.show - Unregistered dialog: ' + name);
            }

            var dialog = {
                settings: {
                    close: function(data) {
                        self.close(data, dialog, dfd);
                    },
                    params: params,
                    title: dialogConfigToShow.title
                },
                componentName: dialogConfigToShow.componentName,
                visible: ko.observable(true),
                previousScrollPosition: $(document).scrollTop()
            };

            if (self.currentDialog()) {
                self.currentDialog().visible(false);
            }

            self.loadedDialogs.push(dialog);
        } catch (err) {
            dfd.reject(err);
        }
    }).promise();
};

Dialoger.prototype.showPage = function(url, params) {
    var self = this;

    return new $.Deferred(function(dfd) {
        try {

            if (_.find(self.loadedDialogs(), function(d) {
                    return d.settings.route && d.settings.route.url.toLowerCase() === url.toLowerCase();
                })) {
                dfd.reject('Cannot open dialog for page that is already opened by dialoger: ' + url);
            } else {
                var routerPromise = new $.Deferred(function(routerState) {
                    try {
                        koco.router._navigateInner(url, routerState);
                    } catch (err) {
                        dfd.reject(err);
                    }
                }).promise();

                routerPromise
                    .then(function(context) {

                        var dialog = {
                            settings: Object.assign({
                                close: function(data) {
                                    self.close(data, dialog, dfd);
                                },
                                params: params,
                                title: context.pageTitle,
                                isDialog: true
                            }, context),
                            componentName: context.route.page.componentName,
                            visible: ko.observable(true),
                            previousScrollPosition: $(document).scrollTop(),
                            previousContext: getCurrentContext(self)
                        };

                        if (self.currentDialog()) {
                            self.currentDialog().visible(false);
                        }

                        if (!anyPageDialogOpened(self)) {
                            self.routerStateBackOrForward = koco.router.routerState.backOrForward;

                            koco.router.routerState.backOrForward = function(state, direction) {
                                if (direction === 'forward') {
                                    //todo: pas bon dans le cas que c'était un dialog pas d'url?? (a tester)
                                    return self.showPage(state.url /*todo: conserver les params sur le state*/ );
                                } else {
                                    if (self.x) {
                                        self.closeInner(self.x.data, self.x.dialog, self.x.dfd);
                                        self.x = null;
                                    } else {
                                        self.hideCurrentDialog();
                                    }

                                    if (self.currentUrl().toLowerCase() !== koco.router.currentUrl().toLowerCase()) {
                                        var cc = getCurrentContext(self);

                                        return koco.router.setUrlSilently({
                                            url: cc.route.url,
                                            replace: false,
                                            pageTitle: cc.pageTitle
                                        });
                                    }

                                }
                            };

                            //koco.router.disable();
                            // $(window).on('popstate.dialoger', function(e) {
                            //     self.onPopState(e);
                            // });
                        }

                        self.loadedDialogs.push(dialog);

                        koco.router.setUrlSilently({
                            url: context.route.url,
                            pageTitle: context.pageTitle
                        });
                    })
                    .fail(function(err) {
                        dfd.reject(err);
                    });
            }
        } catch (err) {
            dfd.reject(err);
        }
    }).promise();
};

Dialoger.prototype.close = function(data, dialog, dfd) {
    var self = this;

    //if close is called directly, we simulate a back and the back will fire close again
    if (dialog.previousContext && koco.router.currentUrl().toLowerCase() !== dialog.previousContext.route.url.toLowerCase()) {
        self.x = {
            data: data,
            dialog: dialog,
            dfd: dfd
        };
        window.history.go(-1);
    } else {
        self.closeInner(data, dialog, dfd);
    }
};

Dialoger.prototype.closeInner = function(data, dialog, dfd) {
    var self = this;


    self.loadedDialogs.remove(dialog);

    //var currentContext = getCurrentContext(self);

    // if (!dialog.previousContext && currentContext.route.url !== window.location.href) {
    //     koco.router.setUrlSilently({
    //         url: currentContext.route.url,
    //         pageTitle: currentContext.pageTitle,
    //         replace: false
    //     });
    // }

    var previousDialog = self.currentDialog();

    if (previousDialog) {
        previousDialog.visible(true);
    }

    if (!anyPageDialogOpened(self) && self.routerStateBackOrForward) {
        //$(window).off('popstate.dialoger');
        //koco.router.enable();

        koco.router.routerState.backOrForward = self.routerStateBackOrForward;
        self.routerStateBackOrForward = null;
    }

    //todo: attendre apres dialog removed from html...
    //important de le faire apres que le dialog soit enlever car
    //la position peut ne pas etre disponible dans le dialog
    //ceci dit... ca pourrait causer des problemes avec le paging...
    //il faudrait bloquer le paging tant que le scroll position n'a pas été rétabli
    $(document).scrollTop(dialog.previousScrollPosition);

    dfd.resolve(data);
};

// Dialoger.prototype.onPopState = function() {
//     var self = this;

//     self.hideCurrentDialog();
// };

Dialoger.prototype.hideCurrentDialog = function() {
    var currentDialog = this.currentDialog();

    if (currentDialog) {
        currentDialog.settings.close();
    }
};

Dialoger.prototype.registerDialog = function(name, dialogConfig) {
    if (!name) {
        throw new Error('Dialoger.registerDialog - Argument missing exception: name');
    }

    dialogConfig = dialogConfig || {};
    dialogConfig.name = name;
    var componentConfig = buildComponentConfigFromDialogConfig(name, dialogConfig);
    ko.components.register(componentConfig.name, componentConfig);

    var finalDialogConfig = applyDialogConventions(name, dialogConfig, componentConfig);

    this.dialogConfigs.push(finalDialogConfig);
};

Dialoger.prototype.currentUrl = function() {
    var self = this;
    return getCurrentContext(self).route.url;
};

function anyPageDialogOpened(self) {
    return !!_.some(self.loadedDialogs(), function(dialog) {
        return !!dialog.previousContext;
    });
}

function getCurrentContext(self) {
    if (self.isDialogOpen()) {
        var pageDialog = _.find(self.loadedDialogs().slice().reverse(), function(dialog) {
            return !!dialog.previousContext;
        });

        if (pageDialog) {
            return pageDialog.settings;
        }
    }

    return koco.router.context();
}

function registerOrUnregisterHideDialogKeyboardShortcut(self, isDialogOpen) {

    var hideCurrentDialog = function(e) {
        switch (e.keyCode) {
            case KEYCODE_ESC:
                self.hideCurrentDialog();
                break;
        }
    };

    if (isDialogOpen) {
        $(document).on('keydown', hideCurrentDialog);
    } else {
        $(document).off('keydown', hideCurrentDialog);
    }
}

function buildComponentConfigFromDialogConfig(name, dialogConfig) {
    return {
        name: name + '-dialog',
        htmlOnly: dialogConfig.htmlOnly,
        basePath: dialogConfig.basePath,
        isBower: dialogConfig.isBower,
        type: 'dialog'
    };
}

function applyDialogConventions(name, dialogConfig, componentConfig) {
    var finalDialogConfig = Object.assign({}, dialogConfig);

    if (!finalDialogConfig.title) {
        finalDialogConfig.title = name;
    }

    finalDialogConfig.componentName = componentConfig.name;

    return finalDialogConfig;
}

function getDialogElement() {
    var dialogerElements = document.getElementsByName('dialoger');

    if (dialogerElements.length < 1) {
        throw new Error('Dialoger.show - Cannot show dialog if dialoger component is not part of the page.');
    }

    if (dialogerElements.length > 1) {
        throw new Error('Dialoger.show - Cannot show dialog if more than one dialoger component is part of the page.');
    }

    return dialogerElements[0];
}

function findByName(collection, name) {
    var result = _.find(collection, function(obj) {
        return obj.name === name;
    });

    return result || null;
}

export default new Dialoger();

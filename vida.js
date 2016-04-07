/**
 * Vida6 - An ES6 controller for Verovio
 *
 * Required options on initialization (or set later with setDefaults()):
 * -parentElement: a JS DOM API node in which to crete the Vida UI
 * -workerLocation: location of the verovioWorker.js script included in this repo; relative to vida.js or absolute-pathed
 * -verovioLocation: location of the verovio toolkit copy you wish to use, relative to verovioWorker.js or absolute-pathed
 *
 * Optional options:
 * -debug: will print out console errors when things go wrong
 */

export class VidaController
{
    constructor(options)
    {
    }
}

export class VidaView 
{
    // options needs to include workerLocation and parentElement
    constructor(options)
    {
        options = options || {};
        this.debug = options.debug;
        this.parentElement = options.parentElement;
        this.workerLocation = options.workerLocation;
        this.verovioLocation = options.verovioLocation;

        // One of the little quirks of writing in ES6, bind events
        this.bindListeners();

        // initializes ui underneath the parent element, as well as Verovio communication
        this.initializeLayoutAndWorker();

        // "Global" variables
        this.resizeTimer = undefined;
        this.verovioSettings = {
            pageHeight: 100,
            pageWidth: 100,
            inputFormat: 'mei', // change at thy own risk
            scale: 40,
            border: 50,
            noLayout: 0,    //1 or 0 (NOT boolean, but mimicing it) for whether the page will display horizontally or vertically
            ignoreLayout: 1,
            adjustPageHeight: 1
        };
        this.mei = undefined; // saved in Vida as well as the worker, unused for now
        this.verovioContent = undefined; // svg output
        this.systemData = [ // stores offsets and ids of each system
            /* {
                'topOffset':
                'id': 
            } */
        ];
        
        this.currentSystem = 0; // topmost system object within the Vida display
        this.totalSystems = 0; // total number of system objects

        // For dragging
        this.clickedPage; // last clicked page
        this.drag_info = {
            /*
            "x": position of clicked note
            "initY": initial Y position
            "svgY": scaled initial Y position 
            "pixPerPix": conversion between the above two
            */
        };
        this.dragging;
        this.highlighted_cache = [];
        // this.verovioWorker = options.controller.verovioWorker;

        this.ticketID = 0;
        this.tickets = {};
    }

    setDefaults(options)
    {
        this.parentElement = options.parentElement;
        this.workerLocation = options.workerLocation;
        this.verovioLocation = options.verovioLocation;

        // Attempt to re-run layout init
        this.initializeLayoutAndWorker();
    }

    destroy()
    {
        window.addEventListener('resize', this.boundResize);

        this.ui.svgOverlay.removeEventListener('scroll', this.boundSyncScroll); 
        this.ui.nextPage.removeEventListener('click', this.boundGotoNext);
        this.ui.prevPage.removeEventListener('click', this.boundGotoPrev);
        this.ui.orientationToggle.removeEventListener('click', this.boundOrientationToggle);
        this.ui.zoomIn.removeEventListener('click', this.boundZoomIn);
        this.ui.zoomOut.removeEventListener('click', this.boundZoomOut);

        this.ui.svgOverlay.removeEventListener('click', this.boundObjectClick);
        const notes = this.ui.svgOverlay.querySelectorAll(".note");
        for (idx = 0; idx < notes.length; idx++)
        {
            const note = notes[idx];

            note.removeEventListener('mousedown', this.boundMouseDown);
            note.removeEventListener('touchstart', this.boundMouseDown);
        }

        document.removeEventListener("mousemove", this.boundMouseMove);
        document.removeEventListener("mouseup", this.boundMouseUp);
        document.removeEventListener("touchmove", this.boundMouseMove);
        document.removeEventListener("touchend", this.boundMouseUp);
    }

    /**
     * Init code separated out for cleanliness' sake
     */
    initializeLayoutAndWorker()
    {
        if (!this.parentElement || !this.workerLocation || !this.verovioLocation)
        {
            if (this.debug)
                console.error("Vida could not be fully instantiated. Please set whatever is undefined of the following three using (vida).setDefaults({}):\n" + 
                    "parentElement: " + this.parentElement + "\n" +
                    "workerLocation: " + this.workerLocation + "\n" +
                    "verovioLocation: " + this.verovioLocation);
            return false;
        }

        this.ui = {
            parentElement: this.parentElement, // must be DOM node
            svgWrapper: undefined,
            svgOverlay: undefined,
            controls: undefined,
            popup: undefined
        };

        // Set up the base layout
        this.ui.parentElement.innerHTML = '<div id="vida-page-controls">' +
            '<div id="vida-prev-page" class="vida-direction-control"></div>' +
            '<div id="vida-zoom-controls">' +
                '<span id="vida-zoom-in" class="vida-zoom-control"></span>' +
                '<span id="vida-zoom-out" class="vida-zoom-control"></span>' +
            '</div>' +
            //'<div class="vida-grid-toggle">Toggle to grid</div>' +
            '<div id="vida-next-page" class="vida-direction-control"></div>' +
            '<div id="vida-orientation-toggle">Toggle orientation</div>' +
        '</div>' +
        '<div id="vida-svg-wrapper" class="vida-svg-object" style="z-index: 1; position:absolute;"></div>' +
        '<div id="vida-svg-overlay" class="vida-svg-object" style="z-index: 1; position:absolute;"></div>' +
        '<div id="vida-loading-popup"></div>';

        window.addEventListener('resize', this.boundResize);

        // If this has already been instantiated , undo events
        if (this.ui && this.ui.svgOverlay) this.destroy();

        // Set up the UI object
        this.ui.svgWrapper = document.getElementById("vida-svg-wrapper");
        this.ui.svgOverlay = document.getElementById("vida-svg-overlay");
        this.ui.controls = document.getElementById("vida-page-controls");
        this.ui.popup = document.getElementById("vida-loading-popup");
        this.ui.nextPage = document.getElementById("vida-next-page");
        this.ui.prevPage = document.getElementById("vida-prev-page");
        this.ui.orientationToggle = document.getElementById("vida-orientation-toggle");
        this.ui.zoomIn = document.getElementById("vida-zoom-in");
        this.ui.zoomOut = document.getElementById("vida-zoom-out");

        // synchronized scrolling between svg overlay and wrapper
        this.ui.svgOverlay.addEventListener('scroll', this.boundSyncScroll); 

        // control bar events
        this.ui.nextPage.addEventListener('click', this.boundGotoNext);
        this.ui.prevPage.addEventListener('click', this.boundGotoPrev);
        this.ui.orientationToggle.addEventListener('click', this.boundOrientationToggle);
        this.ui.zoomIn.addEventListener('click', this.boundZoomIn);
        this.ui.zoomOut.addEventListener('click', this.boundZoomOut);

        // simulate a resize event
        this.updateDims();

        // Initialize the Verovio WebWorker wrapper
        this.verovioWorker = new Worker(this.workerLocation); // the threaded wrapper for the Verovio object
        this.verovioWorker.postMessage(['setVerovio', this.verovioLocation])
        var self = this; // for referencing it inside onmessage
        this.verovioWorker.onmessage = function(event){
            const vidaOffset = self.ui.svgWrapper.getBoundingClientRect().top;
            let eventType = event.data[0];
            let ticket = event.data[1];
            let params = event.data[2];
            switch (eventType){ // all cases have the rest of the array returned notated in a comment
                case "dataLoaded": // [page count]
                    for(var pIdx = 0; pIdx < params.pageCount; pIdx++)
                    {
                        self.ui.svgWrapper.innerHTML += "<div class='vida-system-wrapper' data-index='" + pIdx + "'></div>";
                        self.contactWorker("renderPage", {'pageIndex': pIdx});
                    }
                    break;

                case "returnPage": // [page index, rendered svg]
                    const systemWrapper = document.querySelector(".vida-system-wrapper[data-index='" + params.pageIndex + "']");
                    systemWrapper.innerHTML = params.svg;

                    // Add data about the available systems here
                    const systems = self.ui.svgWrapper.querySelectorAll('g[class=system]');
                    for(var sIdx = 0; sIdx < systems.length; sIdx++)
                        self.systemData[sIdx] = {
                            'topOffset': systems[sIdx].getBoundingClientRect().top - vidaOffset - self.verovioSettings.border,
                            'id': systems[sIdx].id
                        };

                    // update the global tracking var
                    self.totalSystems = self.systemData.length;

                    // create the overlay, save the content, remove the popup, make sure highlights are up to date
                    if(params.notNeededSoon) self.createOverlay();
                    self.verovioContent = self.ui.svgWrapper.innerHTML;
                    self.ui.popup.remove();
                    self.reapplyHighlights();
                    break;

                case "mei": // [mei as interpreted by Verovio]
                    mei = params.mei;
                    break;

                default:
                case "error":
                    console.log("Error message from Verovio:", params);
                    break;
            }
        };
    }

    // Necessary for how ES6 "this" works
    bindListeners()
    {
        this.boundSyncScroll = (evt) => this.syncScroll(evt);
        this.boundGotoNext = (evt) => this.gotoNextPage(evt);
        this.boundGotoPrev = (evt) => this.gotoPrevPage(evt);
        this.boundOrientationToggle = (evt) => this.toggleOrientation(evt);
        this.boundZoomIn = (evt) => this.zoomIn(evt);
        this.boundZoomOut = (evt) => this.zoomOut(evt);
        this.boundObjectClick = (evt) => this.objectClickListener(evt);

        this.boundMouseDown = (evt) => this.mouseDownListener(evt);
        this.boundMouseMove = (evt) => this.mouseMoveListener(evt);
        this.boundMouseUp = (evt) => this.mouseUpListener(evt);

        this.boundResize = (evt) => this.resizeComponents(evt);
    }

    contactWorker(messageType, params, callback)
    {
        // array passed is [messageType, ticketNumber, dataObject]
        this.tickets[this.ticketID] = callback;
        this.verovioWorker.postMessage([messageType, this.ticketID, params]);
        this.ticketID++;
    }

    updateDims()
    {
        this.ui.svgOverlay.style.height = this.ui.svgWrapper.style.height = this.ui.parentElement.clientHeight - this.ui.controls.clientHeight;
        this.ui.svgOverlay.style.top = this.ui.svgWrapper.style.top = this.ui.controls.clientHeight;
        this.ui.svgOverlay.style.width = this.ui.svgWrapper.style.width = this.ui.parentElement.clientWidth;
    }

    initPopup(text)
    {
        this.ui.popup.style.top = this.ui.parentElement.getBoundingClientRect().top + 50;
        this.ui.popup.style.left = this.ui.parentElement.getBoundingClientRect().left + 30;
        this.ui.popup.innerHTML = text;
        this.ui.popup.style.display = "block";
    }

    hidePopup()
    {
        this.ui.popup.innerHTML = "";
        this.ui.popup.style.display = "none";
    }

    // Used to reload Verovio, or to provide new MEI
    refreshVerovio(mei)
    {
        if (mei) this.mei = mei;
        if (!this.mei) return;

        this.ui.svgOverlay.innerHTML = this.ui.svgWrapper.innerHTML = this.verovioContent = "";
        this.verovioSettings.pageHeight = Math.max(this.ui.svgWrapper.clientHeight * (100 / this.verovioSettings.scale) - this.verovioSettings.border, 100); // minimal value required by Verovio
        this.verovioSettings.pageWidth = Math.max(this.ui.svgWrapper.clientWidth * (100 / this.verovioSettings.scale) - this.verovioSettings.border, 100); // idem     
        this.contactWorker('setOptions', {'options': JSON.stringify(this.verovioSettings)});
        this.contactWorker('loadData', {'mei': this.mei + "\n"}, (event) => {
            self.pageCount = event.data[1];
            for(var pIdx = 0; pIdx < self.pageCount; pIdx++)
            {
                self.ui.svgWrapper.innerHTML += "<div class='vida-system-wrapper' data-index='" + pIdx + "'></div>";
                self.contactWorker("renderPage", {'pageIndex': pIdx});
            }
        });
    }

    createOverlay()
    {
        // Copy wrapper HTML to overlay
        this.ui.svgOverlay.innerHTML = this.ui.svgWrapper.innerHTML;

        // Make all <g>s and <path>s transparent, hide the text
        var idx;
        const gElems = this.ui.svgOverlay.querySelectorAll("g");
        for (idx = 0; idx < gElems.length; idx++)
        {
            gElems[idx].style.strokeOpacity = 0.0;
            gElems[idx].style.fillOpacity = 0.0;
        }
        const pathElems = this.ui.svgOverlay.querySelectorAll("path");
        for (idx = 0; idx < pathElems.length; idx++)
        {
            pathElems[idx].style.strokeOpacity = 0.0;
            pathElems[idx].style.fillOpacity = 0.0;
        }
        delete this.ui.svgOverlay.querySelectorAll("text");

        // Add event listeners for click
        this.ui.svgOverlay.removeEventListener('click', this.boundObjectClick);
        this.ui.svgOverlay.addEventListener('click', this.boundObjectClick);
        const notes = this.ui.svgOverlay.querySelectorAll(".note");
        for (idx = 0; idx < notes.length; idx++)
        {
            const note = notes[idx];

            note.removeEventListener('mousedown', this.boundMouseDown);
            note.removeEventListener('touchstart', this.boundMouseDown);
            note.addEventListener('mousedown', this.boundMouseDown);
            note.addEventListener('touchstart', this.boundMouseDown);
        }
        // this.ui.svgOverlay.querySelectorAll("defs").append("filter").attr("id", "selector");
        // resizeComponents();
    }

    updateNavIcons()
    {
        if (this.currentSystem === this.totalSystems - 1) this.ui.nextPage.style.visibility = 'hidden';
        else this.ui.nextPage.style.visibility = 'visible';

        if (this.currentSystem === 0) this.ui.prevPage.style.visibility = 'hidden';
        else this.ui.prevPage.style.visibility = 'visible';
    }

    updateZoomIcons()
    {
        if (this.verovioSettings.scale == 100) this.ui.zoomIn.style.visibility = 'hidden';
        else this.ui.zoomIn.style.visibility = 'visible';

        if (this.verovioSettings.scale == 10) this.ui.zoomOut.style.visibility = 'hidden';
        else this.ui.zoomOut.style.visibility = 'visible';
    }

    scrollToObject(id)
    {
        var obj = this.ui.svgOverlay.querySelector("#" + id).closest('.vida-svg-wrapper');
        scrollToPage(obj.parentNode.children.indexOf(obj));
    }

    scrollToPage(pageNumber)
    {
        var toScrollTo = this.systemData[pageNumber].topOffset;
        this.ui.svgOverlay.scrollTop = toScrollTo;
        this.updateNavIcons();
    }

    /**
     * Event listeners
     */
    resizeComponents()
    {
        // Immediately: resize larger components
        this.updateDims();

        // Set timeout for resizing Verovio once full resize action is complete
        clearTimeout(this.resizeTimer);
        const self = this;
        this.resizeTimer = setTimeout(function ()
        {
            console.log(self);
            self.refreshVerovio();
        }, 200);
    }

    syncScroll(e)
    {
        if (!this.verovioSettings.noLayout)
        {
            var newTop = this.ui.svgWrapper.scrollTop = e.target.scrollTop;
            for(var idx = 0; idx < this.systemData.length; idx++)
            {
                if(newTop <= this.systemData[idx].topOffset + 25)
                {
                    this.currentSystem = idx;
                    break;
                }
            }
        }

        else this.ui.svgWrapper.scrollLeft = this.ui.svgOverlay.scrollLeft;

        this.updateNavIcons();
    }

    gotoNextPage()
    {
        if (this.currentSystem < this.totalSystems - 1) this.scrollToPage(this.currentSystem + 1);
    }

    gotoPrevPage()
    {
        if (this.currentSystem > 0) this.scrollToPage(this.currentSystem - 1);
    }

    toggleOrientation() // TODO: this setting might not be right. IgnoreLayout instead?
    {
        var dirControls = document.getElementsByClassName("vida-direction-control");
        if(this.verovioSettings.noLayout === 1)
        {
            this.verovioSettings.noLayout = 0;
            for (var dIdx = 0; dIdx < dirControls.length; dIdx++)
                dirControls[dIdx].style['display'] = 'block';
        }
        else
        {
            this.verovioSettings.noLayout = 1;
            for (var dIdx = 0; dIdx < dirControls.length; dIdx++)
                dirControls[dIdx].style['display'] = 'none';
        }

        this.refreshVerovio();
    }

    zoomIn()
    {
        if (this.verovioSettings.scale <= 100)
        {
            this.verovioSettings.scale += 10;
            this.refreshVerovio();
        }
        this.updateZoomIcons();
    }

    zoomOut()
    {
        if (this.verovioSettings.scale > 10)
        {
            this.verovioSettings.scale -= 10;
            this.refreshVerovio();
        }
        this.updateZoomIcons();
    }

    objectClickListener(e)
    {
        var closestMeasure = e.target.closest(".measure");
        if (closestMeasure)
            console.log("Would have published measureClicked", closestMeasure);
            // mei.Events.publish('MeasureClicked', [closestMeasure]);
        e.stopPropagation();
    }

    mouseDownListener(e)
    {
        var t = e.target;
        var id = t.parentNode.attributes.id.value;
        var sysID = t.closest('.system').attributes.id.value;

        for(var idx = 0; idx < this.systemData.length; idx++)
            if(this.systemData[idx].id == sysID)
            {
                this.clickedPage = idx;
                break;
            }

        this.resetHighlights();
        this.activateHighlight(id);

        var viewBoxSVG = t.closest("svg");
        var parentSVG = viewBoxSVG.parentNode.closest("svg");
        var actualSizeArr = viewBoxSVG.getAttribute("viewBox").split(" ");
        var actualHeight = parseInt(actualSizeArr[3]);
        var svgHeight = parseInt(parentSVG.getAttribute('height'));
        var pixPerPix = (actualHeight / svgHeight);

        this.drag_info["x"] = t.getAttribute("x") >> 0;
        this.drag_info["svgY"] = t.getAttribute("y") >> 0;
        this.drag_info["initY"] = e.pageY
        this.drag_info["pixPerPix"] = pixPerPix;

        // we haven't started to drag yet, this might be just a selection
        document.addEventListener("mousemove", this.boundMouseMove);
        document.addEventListener("mouseup", this.boundMouseUp);
        document.addEventListener("touchmove", this.boundMouseMove);
        document.addEventListener("touchend", this.boundMouseUp);
        this.dragging = false;
        console.log("Would have published highlightSelected");
    };

    mouseMoveListener(e)
    {
        const scaledY = (e.pageY - this.drag_info.initY) * this.drag_info.pixPerPix;
        for (var idx = 0; idx < this.highlighted_cache.length; idx++)
            this.ui.svgOverlay.querySelector("#" + this.highlighted_cache[idx]).setAttribute("transform", "translate(0, " + scaledY + ")");

        this.dragging = true;
        e.preventDefault();
    };

    mouseUpListener(e)
    {
        document.removeEventListener("mousemove", this.boundMouseMove);
        document.removeEventListener("mouseup", this.boundMouseUp);
        document.removeEventListener("touchmove", this.boundMouseMove);
        document.removeEventListener("touchend", this.boundMouseUp);

        if (!this.dragging) return;
        this.commitChanges(e.pageY);
    }

    commitChanges(finalY)
    {
        for (var idx = 0; idx < this.highlighted_cache.length; idx++)
        {
            const id = this.highlighted_cache[idx];
            const obj = this.ui.svgOverlay.querySelector("#" + id);
            const scaledY = this.drag_info.svgY + (finalY - this.drag_info.initY) * this.drag_info.pixPerPix;
            obj.style["transform"] =  "translate(" + [0 , scaledY] + ")";
            obj.style["fill"] = "#000";
            obj.style["stroke"] = "#000";
            
            const editorAction = JSON.stringify({
                action: 'drag', 
                param: { 
                    elementId: id, 
                    x: parseInt(this.drag_info.x),
                    y: parseInt(scaledY) 
                }   
            });

            this.contactWorker('edit', {'action': editorAction, 'pageIndex': this.clickedPage, 'notNeededSoon': false}); 
            if (this.dragging) this.removeHighlight(id);
        }

        if (this.dragging)
        {
            this.contactWorker("renderPage", {'pageIndex': this.clickedPage, 'notNeededSoon': true});
            this.dragging = false;
            this.drag_info = {};
        }
    };

    activateHighlight(id)
    {
        if (this.highlighted_cache.indexOf(id) > -1) return;

        this.highlighted_cache.push(id);
        this.reapplyHighlights();
        this.hideNote(id);
    }

    reapplyHighlights()
    {
        for(var idx = 0; idx < this.highlighted_cache.length; idx++)
        {
            var targetObj = this.ui.svgOverlay.querySelector("#" + this.highlighted_cache[idx]);
            targetObj.setAttribute('style', "fill: #ff0000; stroke: #ff00000; fill-opacity: 1.0; stroke-opacity: 1.0;");
        }
    }

    hideNote(id)
    {
        this.ui.svgWrapper.querySelector("#" + id).setAttribute('style', "fill-opacity: 0.0; stroke-opacity: 0.0;");
    }

    removeHighlight(id)
    {
        var idx = this.highlighted_cache.indexOf(id);
        if (idx === -1) return;

        var removedID = this.highlighted_cache.splice(idx, 1);
        this.ui.svgWrapper.querySelector("#" + id).setAttribute('style', "fill-opacity: 1.0; stroke-opacity: 1.0;");
        this.ui.svgOverlay.querySelector("#" + removedID).setAttribute('style', "fill: #000000; stroke: #0000000; fill-opacity: 0.0; stroke-opacity: 0.0;");
    }

    resetHighlights()
    {
        while(this.highlighted_cache[0]) this.removeHighlight(this.highlighted_cache[0]);
    }
}
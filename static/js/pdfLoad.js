const { pdfjsLib } = globalThis;

// The workerSrc property shall be specified. (see workerSrc defined in index.html)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;


export function display_pdf_local(onchange_evt, canvas_elem) {
    var file = onchange_evt.target.files[0];
    // Read the file using file reader
    var fileReader = new FileReader();
    fileReader.onload = function () {
        // turn array buffer into typed array
        var typedarray = new Uint8Array(this.result);
        // pdfjs should be able to read this
        const loadingTask = pdfjsLib.getDocument(typedarray);
        loadingTask.promise.then(pdf => {
            // pdf doc is loaded
            // Load first page
            pdf.getPage(1).then(function (page) {
                const scale = 1.5;
                const viewport = page.getViewport({ scale: scale, });
                // Support HiDPI-screens.
                const outputScale = window.devicePixelRatio || 1;

                const canvas = canvas_elem;
                const context = canvas.getContext('2d');

                canvas.width = Math.floor(viewport.width * outputScale);
                canvas.height = Math.floor(viewport.height * outputScale);
                canvas.style.width = Math.floor(viewport.width) + "px";
                canvas.style.height = Math.floor(viewport.height) + "px";

                const transform = outputScale !== 1
                    ? [outputScale, 0, 0, outputScale, 0, 0]
                    : null;

                const renderContext = {
                    canvasContext: context,
                    transform: transform,
                    viewport: viewport
                };
                page.render(renderContext);
            });
        });
    };
    // Read the file as ArrayBuffer
    fileReader.readAsArrayBuffer(file);
}


export function display_pdf(file_obj, canvas_elem) {
    const loadingTask = pdfjsLib.getDocument(file_obj);
    loadingTask.promise.then(pdf => {
        // pdf doc is loaded
        // Load first page
        pdf.getPage(1).then(function (page) {
            const scale = 1.5;
            const viewport = page.getViewport({ scale: scale, });
            // Support HiDPI-screens.
            const outputScale = window.devicePixelRatio || 1;

            const canvas = canvas_elem;
            const context = canvas.getContext('2d');

            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = Math.floor(viewport.width) + "px";
            canvas.style.height = Math.floor(viewport.height) + "px";

            const transform = outputScale !== 1
                ? [outputScale, 0, 0, outputScale, 0, 0]
                : null;

            const renderContext = {
                canvasContext: context,
                transform: transform,
                viewport: viewport
            };
            page.render(renderContext);
        });
    });
}


globalThis.display_pdf = display_pdf;
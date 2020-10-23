'use strict';

$(".infoRightButton").on("click", function(event) {
    if ($(this).parent().next().attr('id') === "infoViewerCanvas") {
        $(this).parent().next().toggleClass("visibilityHidden");
    }
    else {
        $(this).parent().next().toggleClass("displayNone");
    }
});

$(".infoLeftButton").on("click", function(event) {
    if (this.id === "readReviews") {
        $("#reviewsForm").submit();
    }
    else {
        console.log("write review");
    }
});

window.addEventListener("load", (event) => {
    var image = document.getElementById("infoCoverImage");
    if (image.naturalHeight === 1&& image.naturalWidth === 1) {
        image.parentElement.classList.add("displayNone");
    }
});



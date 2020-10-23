function hideMenu() {
    console.log("hideMenu");
    if (!($(".menuOptions").hasClass("displayNone"))) {
        $(".menuOptions").addClass("displayNone");
    }
}

$(".menuIcon").on("click", function(event) {
    $(".menuOptions").toggleClass("displayNone");
    event.stopPropagation();
});

$(document).on("click", hideMenu);
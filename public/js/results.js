function getNewPage(event) {
    console.log("in getNewPage");
    var form = document.getElementById("resultsSearchForm");
    var searchString = document.getElementById("searchString").innerText;
    form.setAttribute("action", "/search/" + event.target.innerText);
    form.firstElementChild.setAttribute("value", searchString);
    console.log(event.target);
    console.log(searchString);
    console.log(form.getAttribute("action"));
    console.log(form.firstElementChild.getAttribute("value"));
    form.submit();
    event.stopPropagation();
}

var pageNumbers = document.getElementsByClassName("pageNumber");

for (var i = 0; i < pageNumbers.length; ++i) {
    if (!pageNumbers[i].classList.contains("selectedPage")) {
        pageNumbers[i].addEventListener("click", getNewPage);
    }
}

document.getElementById("resultsSearchForm").setAttribute("action", "/search/1");
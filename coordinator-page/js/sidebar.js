// ==========================
// OJT-LOGS SIDEBAR CONTROL
// ==========================


const sidebar = document.getElementById("sidebar");
const menuBtn = document.getElementById("menu-btn");
const menuBtn2 = document.getElementById("menu-btn2");



// ==========================
// SIDEBAR TOGGLE
// ==========================

if(sidebar && menuBtn){

    menuBtn.addEventListener("click",()=>{

        sidebar.classList.add("close");

    });

}


if(sidebar && menuBtn2){

    menuBtn2.addEventListener("click",()=>{

        sidebar.classList.remove("close");

    });

}



// ==========================
// ACTIVE MENU AUTO DETECT
// ==========================


const currentPage = window.location.pathname.split("/").pop();


const menuLinks = document.querySelectorAll(".menu li a");


menuLinks.forEach(link=>{


    const linkPage = link
        .getAttribute("href")
        .split("/")
        .pop();



    if(linkPage === currentPage){

        link.parentElement.classList.add("active");

    }


});




// ==========================
// RESPONSIVE SIDEBAR
// ==========================


function checkSidebarSize(){


    if(!sidebar) return;


    if(window.innerWidth <= 768){

        sidebar.classList.add("close");

    }
    else{

        sidebar.classList.remove("close");

    }


}



window.addEventListener(
    "resize",
    checkSidebarSize
);



// INITIAL CHECK

checkSidebarSize();
/* ==========================================
   OJT-LOGS REPORTS
========================================== */

document.addEventListener("DOMContentLoaded",()=>{

    initReportSearch();
    initReportFilter();
    animateSummaryCards();
    initTableHover();
    initActionButtons();

});


/* ==========================================
   REPORT SEARCH
========================================== */

function initReportSearch(){

    const search=document.getElementById("searchReport");
    const table=document.getElementById("reportTable");

    if(!search||!table) return;

    search.addEventListener("keyup",()=>{

        const keyword=search.value.toLowerCase();

        table.querySelectorAll("tr").forEach(row=>{

            row.style.display=row.textContent.toLowerCase().includes(keyword)
                ?""
                :"none";

        });

    });

}


/* ==========================================
   REPORT FILTER
========================================== */

function initReportFilter(){

    const filter=document.getElementById("reportFilter");
    const table=document.getElementById("reportTable");

    if(!filter||!table) return;

    filter.addEventListener("change",()=>{

        const value=filter.value.toLowerCase();

        table.querySelectorAll("tr").forEach(row=>{

            if(value==="all"){
                row.style.display="";
                return;
            }

            row.style.display=row.textContent.toLowerCase().includes(value)
                ?""
                :"none";

        });

    });

}


/* ==========================================
   SUMMARY COUNTER
========================================== */

function animateSummaryCards(){

    document.querySelectorAll(".summary-card h3").forEach(card=>{

        const text=card.textContent.trim();
        const target=parseInt(text);

        if(isNaN(target)) return;

        let current=0;
        const step=Math.ceil(target/40);

        const timer=setInterval(()=>{

            current+=step;

            if(current>=target){
                current=target;
                clearInterval(timer);
            }

            card.textContent=current;

        },20);

    });

}


/* ==========================================
   TABLE HOVER
========================================== */

function initTableHover(){

    document.querySelectorAll(".reports-table tbody tr").forEach(row=>{

        row.addEventListener("mouseenter",()=>{

            row.style.background="#fafafa";

        });

        row.addEventListener("mouseleave",()=>{

            row.style.background="";

        });

    });

}


/* ==========================================
   ACTION BUTTONS
========================================== */

function initActionButtons(){

    document.querySelectorAll(".action-btn.view").forEach(btn=>{

        btn.addEventListener("click",()=>{

            const report=getReportName(btn);

            alert("Previewing\n\n"+report);

        });

    });


    document.querySelectorAll(".action-btn.download").forEach(btn=>{

        btn.addEventListener("click",()=>{

            const report=getReportName(btn);

            alert("Downloading\n\n"+report);

        });

    });


    document.querySelectorAll(".action-btn.generate").forEach(btn=>{

        btn.addEventListener("click",()=>{

            const report=getReportName(btn);

            alert("Generating\n\n"+report);

        });

    });

}


/* ==========================================
   GET REPORT NAME
========================================== */

function getReportName(button){

    return button.closest("tr").cells[0].textContent;

}


/* ==========================================
   EXPORT BUTTONS
========================================== */

document.querySelectorAll(".export-btn").forEach(button=>{

    button.addEventListener("click",()=>{

        if(button.classList.contains("pdf")){

            exportPDF();

        }else if(button.classList.contains("excel")){

            exportExcel();

        }else if(button.classList.contains("print")){

            printReports();

        }else if(button.classList.contains("all")){

            exportAll();

        }

    });

});


/* ==========================================
   EXPORT FUNCTIONS
========================================== */

function exportPDF(){

    alert("Exporting reports as PDF...");

}

function exportExcel(){

    alert("Exporting reports as Excel...");

}

function printReports(){

    window.print();

}

function exportAll(){

    alert("Exporting all reports...");

}


/* ==========================================
   FUTURE DATABASE FUNCTIONS
========================================== */

function loadReports(){

    console.log("Load reports from database.");

}

function saveReport(reportId){

    console.log("Save report:",reportId);

}

function deleteReport(reportId){

    console.log("Delete report:",reportId);

}

function generateAttendanceReport(){

    console.log("Attendance Report");

}

function generateProgressReport(){

    console.log("Progress Report");

}

function generateRiskReport(){

    console.log("AI At-Risk Report");

}

function generateSkillGapReport(){

    console.log("AI Skill Gap Report");

}

function generateCompanyReport(){

    console.log("Company Deployment Report");

}
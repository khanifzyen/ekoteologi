// script.js
document.addEventListener('DOMContentLoaded', () => {
    console.log("Aplikasi Ekoteologi Siap");
});

// Fungsi bantu untuk format angka (misal: Poin)
function formatNumber(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.');
}
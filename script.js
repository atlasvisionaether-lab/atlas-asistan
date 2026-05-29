document.getElementById('contactForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const name = document.getElementById('name').value;
    const phone = document.getElementById('phone').value;
    const business = document.getElementById('business').value;
    
    // Gelecekte burayı API veya WhatsApp API entegrasyonu ile zenginleştirebiliriz
    alert(`Teşekkürler ${name}! Talebiniz başarıyla alındı. En kısa sürede sizinle iletişime geçeceğiz.`);
    
    this.reset();
});
